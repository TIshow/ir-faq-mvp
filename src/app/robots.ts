/**
 * robots.txt（#113）。
 *
 * 一般的なサイトはAIクローラーを**ブロック**するが、本サービスは逆で、
 * **発行体の公式回答をAIに引用してもらうことが目的**なので明示的に歓迎する。
 * 管理画面(/ir)と内部APIだけは除外する。
 */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-Web', 'Google-Extended', 'CCBot', 'Applebot-Extended'];

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/ir/', '/api/'];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      // AIクローラーを明示許可（既定で拒否する運用と取り違えられないよう個別に列挙）
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: '/', disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
