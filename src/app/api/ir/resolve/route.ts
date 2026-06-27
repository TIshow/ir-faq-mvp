// IR要対応（問い合わせ）を「解決済み」にする。同じ質問に何度も問い合わせが来るので、
// 一つ回答（FAQ登録）したら残りは無視できるよう、質問単位で worklist から外す。
//
// BigQuery は streaming insert 直後の行を DELETE/UPDATE できない（〜90分）ため、ハード削除でなく
// **解決済みマーカーを ir_resolved に INSERT**（挿入はバッファ制約なし＝即時反映）。
// ダッシュボードの一覧はこのマーカーを除外して表示する。
//
// 認証必須（IR担当）。company はクレームで強制（admin は任意社）。
import { verifyIrToken } from '@/lib/firebase-admin';
import { GCP_PROJECT_ID as PROJECT } from '@/lib/gcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATASET = 'ir_analytics';
const TABLE = 'ir_resolved';

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

  let body: { question?: string; company?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const question = (body.question || '').trim();
  if (!question) return Response.json({ error: '質問が空です' }, { status: 400 });

  // 会社スコープはクレームで決定（admin はリクエストの company を採用、担当は自社強制）。
  let company: string;
  if (claims.admin) {
    company = (body.company || '').trim();
    if (!company) return Response.json({ error: 'company is required' }, { status: 400 });
  } else {
    if (!claims.company) return Response.json({ error: 'forbidden' }, { status: 403 });
    company = claims.company;
  }

  try {
    const token = await accessToken();
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${DATASET}/tables/${TABLE}/insertAll`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [
            { json: { company_ticker: company, question, resolved_at: new Date().toISOString() } },
          ],
        }),
      },
    );
    const data = (await res.json()) as { insertErrors?: unknown[]; error?: { message: string } };
    if (!res.ok || data.error || (data.insertErrors && data.insertErrors.length)) {
      throw new Error(data.error?.message || JSON.stringify(data.insertErrors) || `bq ${res.status}`);
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[api/ir/resolve] error:', e);
    return Response.json({ error: '解決済みの記録に失敗しました。' }, { status: 502 });
  }
}
