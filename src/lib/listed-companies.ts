/**
 * 上場企業レジストリ（非顧客企業）のデータ層（#154）。
 *
 * **サーバー専用。クライアントコンポーネントから import しないこと。**
 * 実測 3,825社 / 562KB で、フロントの初期JS共有分（103KB）の5倍を超える。
 * バンドルに載せると全訪問者がダウンロードすることになり成立しない。
 *
 * 役割分担（#154 の3層）:
 *  - `config/companies.ts` … **顧客企業の契約情報**（datastoreId / isCustomer /
 *    publishOfficialQa / guidedQuestions）。少数なのでバンドルに載せてよい
 *  - ここ … **非顧客企業の一次情報**（EDINETコード一覧から生成・機械が同期）
 *
 * 顧客企業はこのレジストリに**含まれない**（`scripts/edinet/build_registry.py` が除く）。
 * 二重に持つと社名変更時にどちらが正か分からなくなる。
 */
import 'server-only';

import registry from '@/data/listed-companies.json';
import { getCompanyById, companies, type Company } from '@/config/companies';

/** レジストリの1件（EDINETの一次情報だけ）。 */
export interface ListedCompany {
  ticker: string;
  name: string;
  nameEn?: string;
  sector?: string;
  fiscalYearEndMonth?: number;
}

const ALL = registry as ListedCompany[];

/** ティッカー → レジストリの1件。プロセス内で1回だけ索引を作る。 */
const byTicker = new Map(ALL.map((c) => [c.ticker, c]));

/**
 * レジストリの企業を `Company` に写す。
 *
 * **非顧客なので `datastoreId` は付けない**（層2を持たない）。
 * `isCustomer` も立てない＝`isCustomerCompany` が false を返す＝「非公式IR」表示。
 * `publishOfficialQa` も既定 false のまま＝AIには出さない（#124）。
 */
function toCompany(c: ListedCompany): Company {
  return {
    id: `e${c.ticker}`, // 顧客企業のID（'harux' 等）と衝突しない接頭辞
    name: c.name,
    nameEn: c.nameEn ?? '',
    ticker: c.ticker,
    sector: c.sector,
    fiscalYearEndMonth: c.fiscalYearEndMonth,
    isActive: true,
  };
}

/**
 * ティッカーで企業を引く。**顧客企業を優先する。**
 *
 * 顧客が `companies.ts` とレジストリの両方に居ることは無いが、優先順を決めておかないと
 * 「契約情報を持つ方」が落ちる事故が起こりうる。正は常に `companies.ts`。
 */
export function findCompanyByTicker(ticker: string): Company | undefined {
  const customer = companies.find((c) => c.isActive && c.ticker === ticker);
  if (customer) return customer;
  const listed = byTicker.get(ticker);
  return listed ? toCompany(listed) : undefined;
}

/** 企業IDで引く（`companies.ts` → レジストリの `e<ticker>` の順）。 */
export function findCompanyById(id: string): Company | undefined {
  const customer = getCompanyById(id);
  if (customer) return customer;
  const listed = id.startsWith('e') ? byTicker.get(id.slice(1)) : undefined;
  return listed ? toCompany(listed) : undefined;
}

/**
 * 企業を検索する（トップの検索窓・**非顧客への唯一の到達経路**）。
 *
 * 3,825社をカードで並べることはできないので、検索して `/c/<ticker>` に飛ぶ形にする。
 * 顧客企業を先頭に出す——実際に使われている企業が埋もれないように。
 */
export function searchCompanies(query: string, limit = 20): Company[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hit = (c: { ticker?: string; name: string; nameEn?: string }) =>
    c.ticker?.toLowerCase().startsWith(q) ||
    c.name.toLowerCase().includes(q) ||
    !!c.nameEn?.toLowerCase().includes(q);

  const customers = companies.filter((c) => c.isActive && c.ticker && hit(c));
  const rest = ALL.filter(hit).slice(0, limit).map(toCompany);
  // ティッカーで重複排除（顧客が先に入るので顧客側が残る）
  const seen = new Set<string>();
  return [...customers, ...rest]
    .filter((c) => c.ticker && !seen.has(c.ticker) && seen.add(c.ticker))
    .slice(0, limit);
}

/**
 * 検索で到達できる社数（画面に出す数字）。
 *
 * **レジストリの件数そのものではない。** レジストリは顧客企業を除いてあるので、
 * `companies.ts` 側にしか居ない企業を足す必要がある。逆に非顧客が両方に載ることも
 * あるので（動作確認用に置いた 4063 がそう）、単純な足し算だと二重に数える。
 * 画面に出す数字なので、ティッカーの和集合で正確に数える。
 */
export function searchableCompanyCount(): number {
  const tickers = new Set(ALL.map((c) => c.ticker));
  for (const c of companies) if (c.isActive && c.ticker) tickers.add(c.ticker);
  return tickers.size;
}
