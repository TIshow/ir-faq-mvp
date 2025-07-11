'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Company, getActiveCompanies, getCompanyById } from '@/config/companies';

interface CompanyContextType {
  selectedCompany: Company | null;
  setSelectedCompany: (company: Company | null) => void;
  selectCompanyById: (companyId: string) => void;
  companies: Company[];
  isLoading: boolean;
  error: string | null;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

interface CompanyProviderProps {
  children: React.ReactNode;
}

export const CompanyProvider: React.FC<CompanyProviderProps> = ({ children }) => {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初期化処理
  useEffect(() => {
    try {
      const activeCompanies = getActiveCompanies();
      setCompanies(activeCompanies);
      
      // ローカルストレージから前回選択した企業を復元
      const savedCompanyId = localStorage.getItem('selectedCompanyId');
      if (savedCompanyId) {
        const savedCompany = getCompanyById(savedCompanyId);
        if (savedCompany && savedCompany.isActive) {
          setSelectedCompany(savedCompany);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '企業データの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 企業選択時にローカルストレージに保存
  const handleSetSelectedCompany = (company: Company | null) => {
    setSelectedCompany(company);
    if (company) {
      localStorage.setItem('selectedCompanyId', company.id);
    } else {
      localStorage.removeItem('selectedCompanyId');
    }
  };

  // 企業IDから企業を選択
  const selectCompanyById = (companyId: string) => {
    const company = getCompanyById(companyId);
    if (company && company.isActive) {
      handleSetSelectedCompany(company);
    } else {
      setError(`企業 ID "${companyId}" が見つからないか、無効です`);
    }
  };

  const contextValue: CompanyContextType = {
    selectedCompany,
    setSelectedCompany: handleSetSelectedCompany,
    selectCompanyById,
    companies,
    isLoading,
    error
  };

  return (
    <CompanyContext.Provider value={contextValue}>
      {children}
    </CompanyContext.Provider>
  );
};

// カスタムフック
export const useCompany = (): CompanyContextType => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};

// 選択された企業のデータストアIDを取得するヘルパー
export const useSelectedCompanyDatastore = (): string | null => {
  const { selectedCompany } = useCompany();
  return selectedCompany?.datastoreId || null;
};

// 選択された企業のサーチエンジンIDを取得するヘルパー
export const useSelectedCompanySearchEngine = (): string | null => {
  const { selectedCompany } = useCompany();
  return selectedCompany?.searchEngineId || null;
};

// 企業が選択されているかチェックするヘルパー
export const useIsCompanySelected = (): boolean => {
  const { selectedCompany } = useCompany();
  return selectedCompany !== null;
};