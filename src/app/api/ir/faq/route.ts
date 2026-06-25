// FAQ CRUD API（#46 1-1: escalation→FAQ 複利ループ＋管理）。
// POST  : FAQ登録/更新（質問ハッシュIDで upsert＝同一質問は上書き・重複防止）
// GET    : その企業の登録済みFAQ一覧
// DELETE : FAQを1件削除（?id=）
// すべて Firebase 認証＋company クレームでスコープ強制。company別の Discovery Engine
// データストアに structData{question, answer} レコードとして保持し、エージェントが retrieve。
import { createHash } from 'crypto';
import { verifyIrToken, type IrClaims } from '@/lib/firebase-admin';
import { GCP_PROJECT_ID } from '@/lib/gcp';
import { companies } from '@/config/companies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DE = `https://discoveryengine.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/global/collections/default_collection`;

async function accessToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** 会社スコープ: admin は requested を採用、IR担当はクレームの company に強制。 */
function resolveTicker(claims: IrClaims, requested?: string): string | null {
  if (claims.admin) return (requested || '').trim() || null;
  return claims.company || null;
}
const datastoreFor = (ticker: string) => companies.find((c) => c.ticker === ticker)?.datastoreId;

/** 同一質問→同一ID（正規化＋ハッシュ）。upsert で重複を防ぐ。 */
function faqDocId(ticker: string, question: string): string {
  const norm = question.normalize('NFKC').trim();
  const h = createHash('sha256').update(`${ticker}\n${norm}`).digest('hex').slice(0, 24);
  return `faq-${ticker}-${h}`;
}

const branch = (ds: string) => `${DE}/dataStores/${ds}/branches/default_branch/documents`;

// --- POST: 登録/更新（upsert）-------------------------------------------------
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
  const ticker = resolveTicker(claims, body.company);
  const ds = ticker ? datastoreFor(ticker) : undefined;
  if (!ticker || !ds) return Response.json({ error: 'company を特定できません' }, { status: 403 });

  try {
    const token = await accessToken();
    const docId = faqDocId(ticker, question);
    const rawBytes = Buffer.from(`質問: ${question}\n回答: ${answer}`, 'utf-8').toString('base64');
    // allowMissing=true で「無ければ作成・あれば上書き」（同一質問は1レコードに集約）
    const res = await fetch(`${branch(ds)}/${encodeURIComponent(docId)}?allowMissing=true`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structData: {
          question,
          answer,
          source: 'IR想定問答',
          company: ticker,
          author: claims.email ?? null,
          updated_at: new Date().toISOString(),
        },
        content: { mimeType: 'text/plain', rawBytes },
      }),
    });
    const data = (await res.json()) as { error?: { message: string }; id?: string };
    if (!res.ok || data.error) {
      console.error('[api/ir/faq] upsert error:', data.error);
      return Response.json({ error: 'FAQの登録に失敗しました' }, { status: 502 });
    }
    return Response.json({ ok: true, id: docId });
  } catch (e) {
    console.error('[api/ir/faq] POST error:', e);
    return Response.json({ error: 'FAQの登録に失敗しました' }, { status: 502 });
  }
}

// --- GET: 登録済みFAQ一覧 -----------------------------------------------------
export async function GET(request: Request): Promise<Response> {
  const claims = await verifyIrToken(request.headers.get('authorization'));
  if (!claims) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ticker = resolveTicker(claims, searchParams.get('company') ?? undefined);
  const ds = ticker ? datastoreFor(ticker) : undefined;
  if (!ticker || !ds) return Response.json({ error: 'company を特定できません' }, { status: 403 });

  try {
    const token = await accessToken();
    const res = await fetch(`${branch(ds)}?pageSize=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      error?: { message: string };
      documents?: { id: string; structData?: { question?: string; answer?: string } }[];
    };
    if (!res.ok || data.error) {
      return Response.json({ error: 'FAQ一覧の取得に失敗しました' }, { status: 502 });
    }
    const faqs = (data.documents ?? [])
      .filter((d) => d.structData?.answer)
      .map((d) => ({ id: d.id, question: d.structData?.question, answer: d.structData?.answer }));
    return Response.json({ company: ticker, faqs });
  } catch (e) {
    console.error('[api/ir/faq] GET error:', e);
    return Response.json({ error: 'FAQ一覧の取得に失敗しました' }, { status: 502 });
  }
}

// --- DELETE: 1件削除 ----------------------------------------------------------
export async function DELETE(request: Request): Promise<Response> {
  const claims = await verifyIrToken(request.headers.get('authorization'));
  if (!claims) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') || '').trim();
  const ticker = resolveTicker(claims, searchParams.get('company') ?? undefined);
  const ds = ticker ? datastoreFor(ticker) : undefined;
  if (!ticker || !ds) return Response.json({ error: 'company を特定できません' }, { status: 403 });
  // 他社FAQの削除を防ぐ: id は faq-<ticker>- で始まること
  if (!id || !id.startsWith(`faq-${ticker}-`)) {
    return Response.json({ error: '不正なFAQ idです' }, { status: 400 });
  }

  try {
    const token = await accessToken();
    const res = await fetch(`${branch(ds)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('[api/ir/faq] delete status:', res.status);
      return Response.json({ error: 'FAQの削除に失敗しました' }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[api/ir/faq] DELETE error:', e);
    return Response.json({ error: 'FAQの削除に失敗しました' }, { status: 502 });
  }
}
