/**
 * 企業マスター（フロントの唯一の正）。
 * id/name/ticker/sector/datastoreId をエージェントへ渡す（route.ts）。
 *
 * **2階層ある**（#145）:
 *  - **顧客企業**（`datastoreId` あり）= IR室が導入済み。EDINETの数値に加えて
 *    決算資料・想定問答（層2）を持ち、「なぜ」に会社自身の説明で答えられる。
 *    答えられないときは IR窓口へ取り次げる。UIは「公式IR」。
 *  - **非顧客企業**（`datastoreId` なし）= EDINETの数値だけ。数値には答えられるが
 *    「なぜ」は答えられない（材料が無いので創作もしない・#151）。
 *    取り次ぎ先が存在しないので IR窓口のCTAは出さない。UIは「非公式IR」。
 */

export interface Company {
  id: string;                    // アプリケーション用ID
  name: string;                  // 日本語表示名
  nameEn: string;                // 英語名
  ticker?: string;               // 証券コード
  sector?: string;               // 業界
  description?: string;          // 企業説明
  websiteUrl?: string;           // 公式サイト
  /**
   * Discovery Engine データストアID（層2の検索先）。
   *
   * **未設定＝非顧客企業**（#145）。EDINETの数値だけで回答し、「なぜ」には答えない。
   * 3,900社ぶんのデータストアは作れないので、ここが顧客と非顧客の境界になる。
   * エンジンは未設定に耐える（`search_disclosures` が空を返し、
   * WRITE は数値だけの指示に切り替わる）。
   */
  datastoreId?: string;
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
    // **非顧客企業の例**（#145）。`datastoreId` が無い＝層2を持たない。
    // EDINET提出書類の数値だけで回答し、「なぜ」には答えない。UIは「非公式IR」。
    id: 'shinetsu',
    name: '信越化学工業株式会社',
    nameEn: 'Shin-Etsu Chemical Co., Ltd.',
    ticker: '4063',
    sector: '化学',
    description: '塩化ビニル・半導体シリコン',
    websiteUrl: 'https://www.shinetsu.co.jp/jp/ir/',
    isActive: true,
    fiscalYearEndMonth: 3,
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
 * **IR室が導入済みの顧客企業か**（#145）。
 *
 * 判定条件を各所に書き写さない。「層2があるか」「CTAを出すか」「公式と名乗るか」は
 * すべて同じ問いなので、**述語1つに集約**する（`isPublishedCompany` と同じ理由）。
 */
export function isCustomerCompany(company: Company): boolean {
  return !!company.datastoreId;
}

/**
 * UIに出す階層ラベル（#145）。
 *
 * **隠さずに区別する。** 非顧客企業の回答は発行体の承認を経ていないので
 * 「公式」とは名乗れない（#124 の考え方）。一方で数値そのものは
 * その会社自身がEDINETに提出した正本なので、出せないわけではない。
 * ユーザーが違いを理解できるようにラベルで示す。
 */
export function companyTierLabel(company: Company): '公式IR' | '非公式IR' {
  return isCustomerCompany(company) ? '公式IR' : '非公式IR';
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
