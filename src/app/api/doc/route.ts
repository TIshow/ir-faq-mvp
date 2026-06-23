import { Storage } from '@google-cloud/storage';

// @google-cloud/storage は Node ランタイムが必要（Edge 不可）。毎回署名するため動的。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 署名を許可するバケット（任意の gs:// を署名させない＝SSRF/情報漏洩を防ぐホワイトリスト）。
const ALLOWED_BUCKETS = new Set([
  'vis-ir-data',
  'philcompany-ir-data',
  'peers_ir_data',
  'harux-ir-data',
]);

const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15分

const storage = new Storage();

/**
 * 出典PDF（非公開GCS）への時限・署名URL（V4）を発行して 302 リダイレクトする。
 *
 * 出典リンクは gs:// を直接出さず `/api/doc?b=<bucket>&o=<object>&page=<n>` を指す
 * （FactCard の toDocHref が生成）。クリック時に毎回新鮮な署名URLを発行するため、
 * 期限切れリンクが残らず、バケットは非公開のまま閲覧できる。
 *
 * 本番(Cloud Run)は実行SA＋IAM signBlob で署名。ローカルは署名にSA権限/鍵が要る場合がある。
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const bucket = searchParams.get('b') ?? '';
  const object = searchParams.get('o') ?? '';
  const page = searchParams.get('page');

  if (!bucket || !object || !ALLOWED_BUCKETS.has(bucket)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const [signedUrl] = await storage
      .bucket(bucket)
      .file(object)
      .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS });

    // ページ指定はフラグメントで（PDFビューアが #page=N を解釈）
    const location = page ? `${signedUrl}#page=${encodeURIComponent(page)}` : signedUrl;
    return new Response(null, { status: 302, headers: { Location: location } });
  } catch (e) {
    console.error('[api/doc] 署名URLの生成に失敗:', e);
    return new Response('資料リンクの生成に失敗しました。', { status: 502 });
  }
}
