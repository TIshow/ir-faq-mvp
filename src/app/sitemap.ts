/** sitemap.xml（#113）: トップ＋**公開を承認した企業**の公式Q&Aページを列挙する。 */
import type { MetadataRoute } from 'next';
import { getPublishedCompanies } from '@/config/companies';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = getPublishedCompanies().map((c) => ({
    url: `${SITE_URL}/c/${c.ticker}/`,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));
  return [{ url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 }, ...pages];
}
