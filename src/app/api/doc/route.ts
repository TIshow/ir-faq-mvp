// 出典PDF（非公開GCS）をアプリ経由でストリーム配信する。
// 署名URL方式(signBlob)は Cloud Run 上で iamcredentials への通信が "Premature close" で
// 不安定だったため、メタデータサーバのアクセストークンでGCSから直接取得して中継する。
// 依存ライブラリ不要＝バンドル/通信の不確実性を排除。バケットは非公開のまま閲覧できる。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 配信を許可するバケット（任意GCS読み取り＝SSRF/情報漏洩を防ぐホワイトリスト）。
const ALLOWED_BUCKETS = new Set([
  'vis-ir-data',
  'philcompany-ir-data',
  'peers_ir_data',
  'harux-ir-data',
]);

/** Cloud Run 実行SAのアクセストークン（メタデータサーバ。ローカルには無いので本番専用）。 */
async function accessToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata token ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/**
 * GET /api/doc/?b=<bucket>&o=<object>
 * 許可バケットのオブジェクトを SA 権限で取得し、PDF をそのまま中継する。
 * ページ指定はリンク側のフラグメント(#page=N)でビューアが解釈する。
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const bucket = searchParams.get('b') ?? '';
  const object = searchParams.get('o') ?? '';

  if (!bucket || !object || !ALLOWED_BUCKETS.has(bucket)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const token = await accessToken();
    const gcsUrl =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}` +
      `/o/${encodeURIComponent(object)}?alt=media`;
    const upstream = await fetch(gcsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!upstream.ok || !upstream.body) {
      return new Response('資料が見つかりません。', { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e) {
    console.error('[api/doc] 取得失敗:', e);
    return new Response('資料の取得に失敗しました。', { status: 502 });
  }
}
