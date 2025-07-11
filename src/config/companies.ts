/**
 * 企業設定ファイル
 * 複数企業のDiscovery Engine データストア管理
 */

export interface Company {
  id: string;                    // アプリケーション用ID
  name: string;                  // 日本語表示名
  nameEn: string;               // 英語名
  ticker?: string;              // 証券コード
  sector?: string;              // 業界
  description?: string;         // 企業説明
  websiteUrl?: string;          // 公式サイト
  datastoreId: string;          // Discovery Engine データストアID
  searchEngineId: string;       // Search Engine ID
  isActive: boolean;            // 有効/無効
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
    searchEngineId: 'vis-search-engine',
    isActive: true
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
    searchEngineId: 'philcompany-search-engine',
    isActive: true
  }
];

/**
 * 企業IDから企業情報を取得
 */
export function getCompanyById(companyId: string): Company | undefined {
  return companies.find(company => company.id === companyId);
}

/**
 * 有効な企業リストを取得
 */
export function getActiveCompanies(): Company[] {
  return companies.filter(company => company.isActive);
}

/**
 * 企業IDからデータストアIDを取得
 */
export function getDatastoreId(companyId: string): string | undefined {
  const company = getCompanyById(companyId);
  return company?.datastoreId;
}

/**
 * 企業IDからサーチエンジンIDを取得
 */
export function getSearchEngineId(companyId: string): string | undefined {
  const company = getCompanyById(companyId);
  return company?.searchEngineId;
}

/**
 * Discovery Engine用の完全なデータストアパスを構築
 */
export function buildDatastorePath(companyId: string, projectId: string = 'hallowed-trail-462613-v1'): string | undefined {
  const datastoreId = getDatastoreId(companyId);
  if (!datastoreId) return undefined;
  
  return `projects/${projectId}/locations/global/collections/default_collection/dataStores/${datastoreId}`;
}

/**
 * Discovery Engine用の完全なサーチエンジンパスを構築
 */
export function buildSearchEnginePath(companyId: string, projectId: string = 'hallowed-trail-462613-v1'): string | undefined {
  const searchEngineId = getSearchEngineId(companyId);
  if (!searchEngineId) return undefined;
  
  return `projects/${projectId}/locations/global/collections/default_collection/engines/${searchEngineId}`;
}