// IRダッシュボード向け 集計API（#46 1-2b/1-2d）。
// BigQuery interactions を company スコープで集計して返す。
// BQは @google-cloud/* を使わず、メタデータSAトークン＋REST(jobs.query)で叩く
// （/api/doc と同方針：依存を増やさず・バンドル/署名の不確実性を回避）。
// 認証(1-2d): Firebase IDトークンを検証し、company クレームでスコープを強制
//（admin は全社可）。クライアントの company パラメータは詐称防止のため信用しない。
import { verifyIrToken } from '@/lib/firebase-admin';
import { GCP_PROJECT_ID as PROJECT } from '@/lib/gcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const TABLE = `\`${PROJECT}.ir_analytics.interactions\``;
const MAX_BYTES = '100000000'; // 100MB 上限＝暴走課金を構造的に防ぐ

async function accessToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type Param = { name: string; type: 'STRING' | 'INT64'; value: string };

/** BQ jobs.query を named パラメータ＋maximumBytesBilled で実行し、行を素直なオブジェクト配列で返す。 */
async function bqQuery(
  token: string,
  sql: string,
  params: Param[],
): Promise<Record<string, string | null>[]> {
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        maximumBytesBilled: MAX_BYTES,
        parameterMode: 'NAMED',
        queryParameters: params.map((p) => ({
          name: p.name,
          parameterType: { type: p.type },
          parameterValue: { value: p.value },
        })),
      }),
    },
  );
  const data = (await res.json()) as {
    error?: { message: string };
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: string | null }[] }[];
  };
  if (!res.ok || data.error) throw new Error(data.error?.message || `bq query ${res.status}`);
  const fields = data.schema?.fields ?? [];
  return (data.rows ?? []).map((row) => {
    const obj: Record<string, string | null> = {};
    fields.forEach((f, i) => (obj[f.name] = row.f[i]?.v ?? null));
    return obj;
  });
}

export async function GET(request: Request): Promise<Response> {
  // 認証: Firebase IDトークンを検証
  const claims = await verifyIrToken(request.headers.get('authorization'));
  if (!claims) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365);

  // 会社スコープはクレームで決定（クライアントの company は admin のときだけ採用）。
  const requested = (searchParams.get('company') || '').trim();
  let company: string;
  if (claims.admin) {
    company = requested || ''; // admin は任意の company を見られる
    if (!company) return Response.json({ error: 'company is required' }, { status: 400 });
  } else {
    if (!claims.company) return Response.json({ error: 'forbidden' }, { status: 403 });
    company = claims.company; // 担当社に強制（リクエストの company は無視）
  }

  const since: Param[] = [
    { name: 'company', type: 'STRING', value: company },
    { name: 'days', type: 'INT64', value: String(days) },
  ];
  const where = `WHERE company_ticker=@company AND ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)`;

  try {
    const token = await accessToken();

    const byScope = await bqQuery(
      token,
      `SELECT scope_status, COUNT(*) AS c FROM ${TABLE} ${where} GROUP BY scope_status`,
      since,
    );
    const counts = { answered: 0, refused: 0, escalated: 0 };
    for (const r of byScope) {
      const k = r.scope_status as keyof typeof counts;
      if (k in counts) counts[k] = Number(r.c);
    }
    const total = counts.answered + counts.refused + counts.escalated;

    // 未回答（IR要対応）= 投資家が「IR窓口へ問い合わせる」を押したものだけ（自動エスカレは含めない）。
    // 同一質問はグループ化（件数）し、ir_resolved で解決済みにした質問は除外する
    // （同じ問い合わせが多数来ても、一つ解決すれば worklist から消せる）。
    const IRREQ = `\`${PROJECT}.ir_analytics.ir_requests\``;
    const IRRES = `\`${PROJECT}.ir_analytics.ir_resolved\``;
    // 解決済み判定: その質問の解決マーカー(resolved_at)が問い合わせ(ts)以降にあれば対応済みとして除外。
    const irRows = await bqQuery(
      token,
      `SELECT r.question AS question, COUNT(*) AS c,
              FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', MAX(r.ts)) AS asked_at
       FROM ${IRREQ} r
       WHERE r.company_ticker=@company
         AND r.ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
         AND NOT EXISTS (
           SELECT 1 FROM ${IRRES} x
           WHERE x.company_ticker=r.company_ticker AND x.question=r.question AND x.resolved_at >= r.ts
         )
       GROUP BY r.question ORDER BY MAX(r.ts) DESC LIMIT 50`,
      since,
    );
    const irRequests = irRows.length; // 要対応＝未解決のユニーク質問数

    const top = await bqQuery(
      token,
      `SELECT question, COUNT(*) AS c FROM ${TABLE} ${where} GROUP BY question ORDER BY c DESC LIMIT 10`,
      since,
    );

    return Response.json({
      company,
      days,
      totals: {
        ...counts,
        total,
        ir_requests: irRequests,
        answer_rate: total ? Math.round((counts.answered / total) * 1000) / 10 : 0,
      },
      // ユーザーが明示的に問い合わせを依頼した質問（IR要対応ワークリスト・同一質問はグループ化）
      ir_requests_questions: irRows.map((r) => ({
        question: r.question,
        at: r.asked_at,
        count: Number(r.c),
      })),
      top_questions: top.map((r) => ({ question: r.question, count: Number(r.c) })),
    });
  } catch (e) {
    console.error('[api/ir/metrics] error:', e);
    return Response.json({ error: '集計の取得に失敗しました。' }, { status: 502 });
  }
}
