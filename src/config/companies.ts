/**
 * 企業マスター（フロントの唯一の正）。
 * id/name/ticker/sector/datastoreId をエージェントへ渡す（route.ts）。
 *
 * **2階層ある**（#145）。判定は `isCustomerCompany` を必ず通すこと:
 *  - **顧客企業** = IR室が導入済み。決算資料・想定問答（層2）を持ち、「なぜ」に
 *    会社自身の説明で答えられる。答えられないときは IR窓口へ取り次げる。UIは「公式IR」。
 *  - **非顧客企業** = EDINETの数値だけ。数値には答えられるが「なぜ」は答えられない
 *    （材料が無いので創作もしない・#151）。取り次ぎ先が無いので CTA は出さない。UIは「非公式IR」。
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
   * Discovery Engine データストアID（**層2＝開示文書の検索先**）。
   *
   * 未設定なら層2が無い＝「なぜ」に答える材料が無い。エンジンは未設定に耐える
   * （`search_disclosures` が空を返し、WRITE が数値だけの指示に切り替わる・#151）。
   *
   * **顧客かどうかはこれで判定しない**（→ `isCustomer` / `isCustomerCompany`）。
   * 今は一致しているが、非顧客企業の定性情報を当方で収集すると両者とも持つ。
   */
  datastoreId?: string;
  /**
   * **発行体と関係があるか**（#145）。未設定なら `datastoreId` の有無から導出する。
   *
   * 顧客／非顧客を分けているのは技術的な事実ではなく**業務上の関係**（資料の提供と
   * 承認があるか・IR窓口へ取り次げるか）。将来、非顧客企業の定性情報を当方で収集
   * するようになると `datastoreId` では区別できなくなるので、そのときここを明示する。
   * インフラの実体から導出できる間は導出に任せる（**フラグだけ立てて「公式IR」を
   * 名乗れる状態を作らない**ため）。
   */
  isCustomer?: boolean;
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
    // sector / description / websiteUrl は入れない。EDINETから取れず、
    // 記憶で書けば**開示に無い情報の創作**と同じになる（画面とllms.txtに出る）。
    // 3,815社ぶんの調達方法が決まってから入れる。
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
 *
 * **これは「層2があるか」ではなく「発行体と関係があるか」。**
 * 今は非顧客が層2を持たないので `datastoreId` の有無で代用できているが、
 * 非顧客企業の定性情報を当方で収集して食わせるようになると**両者とも層2を持つ**ため
 * この代用は成立しなくなる。そのときは `isCustomer` を明示的に立てるだけでよい
 * （**この関数が唯一の切替点**になるよう、呼び出し側は必ずここを通す）。
 */
export function isCustomerCompany(company: Company): boolean {
  return company.isCustomer ?? !!company.datastoreId;
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
