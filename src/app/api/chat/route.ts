import { NextRequest } from 'next/server';
import { getCompanyById } from '@/config/companies';
import { agentAuthHeader } from '@/lib/agent-auth';
import { allowRequest, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// IR Agent（ADK/FastAPI）のエンドポイント。Cloud Run / Agent Engine のURLを注入。
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8080';

/**
 * エージェントの SSE ストリームをブラウザへそのままプロキシする。
 * 旧 enhanced-rag-service / Firestore 配線は廃止（セッション/記憶はエージェント側）。
 */
export async function POST(request: NextRequest) {
  // #88: 生成コスト連打の抑止（IP単位の簡易レート制限）
  if (!allowRequest(clientIp(request.headers))) {
    return Response.json(
      { error: 'リクエストが多すぎます。少し時間をおいてお試しください。' },
      { status: 429 },
    );
  }

  const { message, companyId, sessionId, history, audience } = await request.json();

  if (!message || message.trim() === '') {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }
  if (!companyId) {
    return Response.json({ error: '企業を選択してください' }, { status: 400 });
  }

  const company = getCompanyById(companyId);
  if (!company) {
    return Response.json({ error: `企業 ${companyId} が見つかりません` }, { status: 400 });
  }

  let upstream: Response;
  try {
    // #88: ir-agent は非公開（IAM保護）。このフロントのSAだけが invoker を持つ。
    const authHeader = await agentAuthHeader(AGENT_URL);
    upstream = await fetch(`${AGENT_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        // 企業コンテキストは companies.ts が唯一の正（エージェント側はハードコードしない）
        message,
        companyTicker: company.ticker ?? company.id,
        companyName: company.name,
        datastoreId: company.datastoreId,
        sessionId: sessionId || 's1',
        // 短期メモリ: 直近の会話履歴（フォロー質問の書き換え用）。サーバはステートレス。
        history: Array.isArray(history) ? history : [],
        // 読者レベル（説明の翻訳度のみ。未知値はサーバ側で中級者に丸める）
        audience: typeof audience === 'string' ? audience : 'intermediate',
      }),
    });
  } catch (e) {
    return Response.json(
      { error: 'Agent unreachable', details: e instanceof Error ? e.message : 'Unknown error' },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: 'Agent error', status: upstream.status }, { status: 502 });
  }

  // SSE をそのまま中継
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
