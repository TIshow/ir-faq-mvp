/**
 * 企業マスター（フロントの唯一の正）。
 * id/name/ticker/sector/datastoreId をエージェントへ渡す（route.ts）。
 * 新企業はここに追加し、対応する Discovery Engine データストアを用意する。
 */

export interface Company {
  id: string;                    // アプリケーション用ID
  name: string;                  // 日本語表示名
  nameEn: string;                // 英語名
  ticker?: string;               // 証券コード
  sector?: string;               // 業界
  description?: string;          // 企業説明
  websiteUrl?: string;           // 公式サイト
  datastoreId: string;           // Discovery Engine データストアID（層2の検索先）
  isActive: boolean;             // 有効/無効
  guidedQuestions?: string[];    // 初期画面のガイドチップ。未設定なら汎用にフォールバック
  /** 決算期の末月（例: 3 = 3月期）。公開Q&Aページ(#113)で「2026FY」を「2026年3月期」と
   *  表記するために使う。**出典資料で確認できた企業にだけ設定する**（不明なら未設定＝FY表記のまま）。 */
  fiscalYearEndMonth?: number;
  /**
   * **その企業の「公式Q&A」をAIに向けて公開してよいか**（#113）。既定 false。
   *
   * true にすると sitemap / llms.txt に載り、JSON-LD(FAQPage) を出し、
   * クローラーにインデックスさせる。**「公式」は発行体の承認を含意する表現**なので、
   * 実際に話が進んでいる（＝現場で使われている）企業だけ true にすること。
   *
   * false でも `/c/<ticker>` は動く（開発・デモ用）。ただし noindex で、
   * sitemap・llms.txt・JSON-LD からは外れる＝AIに「公式」として案内しない。
   */
  publishOfficialQa?: boolean;
}

export const companies: Company[] = [
  {
    id: 'vis',
    name: '株式会社ヴィス',
    nameEn: 'Vis Inc.',
    ticker: '5071',
    sector: '建設業',
    description: 'オフィス空間のプロデュース',
    websiteUrl: 'https://vis-produce.com/',
    datastoreId: 'vis-ir-data_1752223995110',
    isActive: true,
  },
  {
    id: 'philcompany',
    name: '株式会社フィル・カンパニー',
    nameEn: 'Phil Company Inc.',
    ticker: '3267',
    sector: '不動産・建設',
    description: '不動産開発・マンション販売',
    websiteUrl: 'https://www.phil-company.com/',
    datastoreId: 'philcompany-ir-data_1752224320775',
    isActive: true,
  },
  {
    id: 'peers',
    name: '株式会社ピアズ',
    nameEn: 'Peers Inc.',
    ticker: '7066',
    sector: '人材・開発',
    description: '人材派遣・営業コンサル',
    websiteUrl: 'https://peers.jp/',
    datastoreId: 'peers-ir-data_1752651535271',
    isActive: true,
  },
  {
    // 旗艦（深掘り対象）。層1はEDINET XBRLから点灯済み（FY25/FY26実績＋セグメント＋FY27予想）。
    // 層2は Discovery Engine データストア harux-ir-data（決算補足説明資料PDF）。
    id: 'harux',
    name: '株式会社ハークスレイ',
    nameEn: 'HURXLEY CORPORATION',
    ticker: '7561',
    sector: '中食・店舗ソリューション・物流（東証スタンダード）',
    description: '本家かまどや等の中食、店舗アセット＆ソリューション、物流・食品加工',
    websiteUrl: 'https://www.harx.co.jp/',
    datastoreId: 'harux-ir-data',
    isActive: true,
    // 層1の出典が「2026年3月期 決算補足説明資料」＝2026FY は 2026年3月期（確認済み）
    fiscalYearEndMonth: 3,
    // 現場テスト中の唯一の企業。ここだけAIに「公式Q&A」として公開する。
    // 他社は開発・デモ用でデータをリセットする予定のため公開しない（既定 false）。
    publishOfficialQa: true,
    guidedQuestions: [
      '営業利益は前年と比べてどう？',
      'セグメント別の売上は？',
      '来期の会社予想は？',
      '配当はどうなっている？',
      '物流・食品加工事業の状況は？',
    ],
  },
];

/** 企業IDから企業情報を取得 */
export function getCompanyById(companyId: string): Company | undefined {
  return companies.find((company) => company.id === companyId);
}

/** 有効な企業リストを取得 */
export function getActiveCompanies(): Company[] {
  return companies.filter((company) => company.isActive);
}

/**
 * **AIに「公式Q&A」として公開してよい企業か**（#113）。
 * sitemap / llms.txt / JSON-LD / index可否 / トップの数値表示は、
 * すべてこの述語を通すこと。**条件を露出面ごとに書き写さない**
 * （片方だけ直し忘れて意図せず公開される。実際にトップの「公式Q&A N件」で起きた）。
 */
export function isPublishedCompany(company: Company): boolean {
  return !!company.publishOfficialQa && !!company.ticker && company.isActive;
}

/** 公開してよい企業の一覧。 */
export function getPublishedCompanies(): Company[] {
  return companies.filter(isPublishedCompany);
}

/** 表示用の短縮社名（「株式会社」を除去） */
export function companyShortName(name: string): string {
  return name.replace(/^株式会社/, '').replace(/株式会社$/, '');
}
