/**
 * robots.txt（#113）。
 *
 * 一般的なサイトはAIクローラーを**ブロック**するが、本サービスは逆で、
 * **発行体の公式回答をAIに引用してもらうことが目的**なので明示的に歓迎する。
 * 管理画面(/ir)と内部APIだけは除外する。
 *
 * **`/c/` は既定で拒否し、公開を承認した銘柄だけを Allow する**。
 * `noindex` メタタグは*検索インデックス*向けの指示であり、学習・アーカイブ型の
 * クローラー（GPTBot / CCBot / meta-externalagent 等）が取得した本文を破棄する
 * 保証はない。学習系に確実に効くのは robots.txt の Disallow なので、
 * 「公式」を名乗ってよい銘柄以外はここで止める。
 * （実際に meta-externalagent が非公開銘柄のページを取得済み。
 *   一度取られたコピーはこちらから消せないため、以後の取得を止める。）
 */
import type { MetadataRoute } from 'next';
import { getPublishedCompanies } from '@/config/companies';
import { SITE_URL } from '@/lib/site';

const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-Web', 'Google-Extended', 'CCBot', 'Applebot-Extended'];

export default function robots(): MetadataRoute.Robots {
  // 既定で /c/ 全体を拒否し、公開銘柄のパスだけを個別に許可する。
  // より具体的なパスの Allow が Disallow に優先するのは主要クローラー共通の挙動。
  const allow = ['/', ...getPublishedCompanies().map((c) => `/c/${c.ticker}/`)];
  const disallow = ['/ir/', '/api/', '/c/'];
  return {
    rules: [
      { userAgent: '*', allow, disallow },
      // AIクローラーを明示許可（既定で拒否する運用と取り違えられないよう個別に列挙）
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow, disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
