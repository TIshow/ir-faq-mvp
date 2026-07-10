/**
 * /api/chat の簡易レート制限（#88: 課金爆発・連打対策の最後の砦）。
 *
 * インスタンス内メモリの固定ウィンドウ方式（IP単位）。Cloud Run は複数インスタンスに
 * スケールしうるため厳密な上限ではないが、「1人が無限に生成コストを焚ける」状態を防ぐ
 * には十分（正規ユーザーは1質問≒20秒以上かかるので通常利用では到達しない）。
 * 上限は CHAT_RATE_LIMIT_PER_MIN で調整（既定 10 回/分）。
 */
const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 10);

type Bucket = { windowStart: number; count: number };
const buckets = new Map<string, Bucket>();

/** true = 許可 / false = 429 にすべき */
export function allowRequest(ip: string): boolean {
  const now = Date.now();
  // 溜まりすぎ防止の軽い掃除（古いウィンドウのエントリを捨てる）
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
  const b = buckets.get(ip);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  b.count += 1;
  return b.count <= LIMIT;
}

/** Cloud Run 前提のクライアントIP取得（X-Forwarded-For の先頭）。無ければ 'unknown'。 */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : 'unknown';
}
