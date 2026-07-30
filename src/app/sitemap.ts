/** sitemap.xml（#113）: トップ＋各企業の公式Q&Aページを列挙する。 */
import type { MetadataRoute } from 'next';
import { getActiveCompanies } from '@/config/companies';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = getActiveCompanies()
    .filter((c) => c.ticker)
    .map((c) => ({
      url: `${SITE_URL}/c/${c.ticker}/`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  return [{ url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 }, ...pages];
}
