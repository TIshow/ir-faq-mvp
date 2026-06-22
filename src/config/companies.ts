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

/** 表示用の短縮社名（「株式会社」を除去） */
export function companyShortName(name: string): string {
  return name.replace(/^株式会社/, '').replace(/株式会社$/, '');
}
