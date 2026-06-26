// 投資家が「IR窓口へ問い合わせる」CTA を押したときだけ、その質問を IR要対応ワークリスト
// （BigQuery ir_analytics.ir_requests）に記録する。
//
// 設計意図: 未回答かどうかの自動判定は曖昧で、ダッシュボードの要対応一覧が肥大化し IR室が
// 捌けなくなる。そこで「自動エスカレ（scope_status=escalated）」は CTA 表示と回答率分析に
// とどめ、**実際にユーザーが問い合わせを依頼したものだけ**を要対応として記録する。
//
// 認証なし（投資家は非ログイン）。company は companies.ts で検証し、question は長さ制限。
// BQ 書込は @google-cloud/* を使わずメタデータSAトークン＋REST（/api/doc・/api/ir/metrics と同方針）。
import { getCompanyById } from '@/config/companies';
import { GCP_PROJECT_ID as PROJECT } from '@/lib/gcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATASET = 'ir_analytics';
const TABLE = 'ir_requests';
const MAX_QUESTION_LEN = 1000;

async function accessToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function POST(request: Request): Promise<Response> {
  let body: { companyId?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  // 企業は companies.ts が唯一の正。未知の企業は受け付けない（詐称・ゴミ防止）。
  const company = body.companyId ? getCompanyById(body.companyId) : undefined;
  if (!company) return Response.json({ error: '企業が不正です' }, { status: 400 });

  const question = (body.question || '').trim().slice(0, MAX_QUESTION_LEN);
  if (!question) return Response.json({ error: '質問が空です' }, { status: 400 });

  try {
    const token = await accessToken();
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${DATASET}/tables/${TABLE}/insertAll`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [
            {
              json: {
                ts: new Date().toISOString(),
                company_ticker: company.ticker ?? company.id,
                question,
              },
            },
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
    console.error('[api/ir/contact] error:', e);
    return Response.json({ error: 'お取り次ぎの記録に失敗しました。' }, { status: 502 });
  }
}
