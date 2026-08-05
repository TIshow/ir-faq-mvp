/**
 * 企業検索（#154 の続き）— 非顧客3,825社への唯一の到達経路。
 *
 * **なぜサーバー経由か**: レジストリは実測562KBで、フロントの初期JS共有分（103KB）の
 * 5倍を超える。バンドルに載せると全訪問者がダウンロードすることになり成立しない
 * （`src/lib/listed-companies.ts` が `server-only` なのはこのため）。
 *
 * レート制限は掛けていない。LLMを呼ばずメモリ上の配列を引くだけで生成コストが無く、
 * 返す内容も EDINETコード一覧（公開情報）そのものなので、絞る理由がない。
 * `/api` は robots.ts でクローラーに拒否済み。
 */
import { NextRequest } from 'next/server';
import { isCustomerCompany } from '@/config/companies';
import { searchCompanies } from '@/lib/listed-companies';

export const dynamic = 'force-dynamic';

/** 検索結果の1件。**契約情報は返さない**（`datastoreId` は内部インフラの識別子）。 */
export interface CompanyHit {
  ticker: string;
  name: string;
  sector?: string;
  /** 顧客企業＝「公式IR」。UI のバッジ表示に使う（#145） */
  official: boolean;
}

const MAX_LIMIT = 20;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return Response.json({ results: [] satisfies CompanyHit[] });

  const results: CompanyHit[] = searchCompanies(q, MAX_LIMIT)
    .filter((c) => c.ticker)
    .map((c) => ({
      ticker: c.ticker as string,
      name: c.name,
      sector: c.sector,
      official: isCustomerCompany(c),
    }));

  return Response.json({ results });
}
