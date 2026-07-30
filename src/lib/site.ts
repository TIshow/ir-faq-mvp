/** 公開URLの正（robots/sitemap/llms.txt が参照）。環境で上書き可。 */
export const SITE_URL = (
  process.env.SITE_URL ?? 'https://ir-frontend-255752121803.us-central1.run.app'
).replace(/\/$/, '');
