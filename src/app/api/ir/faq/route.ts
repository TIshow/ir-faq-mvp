// FAQ投入API（#46 1-1: escalation→FAQ 複利ループ）。
// IR担当がダッシュボードで未回答に回答 → 対象企業の Discovery Engine データストアに
// structData{question, answer} のドキュメントを1件作成（content も付与）。
// 次回から search_disclosures が retrieve して自動回答する（エージェント無改修）。
//
// 認証(1-2d): Firebase IDトークンを検証し、company クレームでスコープを強制。
// BQ/出典PDFと同方針: メタデータSAトークン＋REST（依存なし）。
import { verifyIrToken } from '@/lib/firebase-admin';
import { GCP_PROJECT_ID } from '@/lib/gcp';
import { companies } from '@/config/companies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function POST(request: Request): Promise<Response> {
  const claims = await verifyIrToken(request.headers.get('authorization'));
  if (!claims) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    question?: string;
    answer?: string;
    company?: string;
  };
  const question = (body.question || '').trim();
  const answer = (body.answer || '').trim();
  if (!question || !answer) {
    return Response.json({ error: 'question と answer は必須です' }, { status: 400 });
  }

  // 会社スコープ: admin は body.company 指定可、IR担当はクレームの company に強制。
  const ticker = claims.admin ? (body.company || '').trim() : claims.company;
  if (!ticker) return Response.json({ error: 'company を特定できません' }, { status: 403 });

  const datastoreId = companies.find((c) => c.ticker === ticker)?.datastoreId;
  if (!datastoreId) {
    return Response.json({ error: `企業(${ticker})のデータストアがありません` }, { status: 400 });
  }

  try {
    const token = await accessToken();
    const docId = `faq-${ticker}-${crypto.randomUUID()}`;
    const rawBytes = Buffer.from(`質問: ${question}\n回答: ${answer}`, 'utf-8').toString('base64');
    const url =
      `https://discoveryengine.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/global` +
      `/collections/default_collection/dataStores/${datastoreId}/branches/default_branch/documents` +
      `?documentId=${encodeURIComponent(docId)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structData: {
          question,
          answer,
          source: 'IR想定問答',
          company: ticker,
          author: claims.email ?? null,
          created_at: new Date().toISOString(),
        },
        content: { mimeType: 'text/plain', rawBytes },
      }),
    });
    const data = (await res.json()) as { error?: { message: string }; id?: string };
    if (!res.ok || data.error) {
      console.error('[api/ir/faq] create error:', data.error);
      return Response.json({ error: 'FAQの登録に失敗しました' }, { status: 502 });
    }
    return Response.json({ ok: true, id: data.id });
  } catch (e) {
    console.error('[api/ir/faq] error:', e);
    return Response.json({ error: 'FAQの登録に失敗しました' }, { status: 502 });
  }
}
