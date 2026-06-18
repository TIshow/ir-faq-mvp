'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Company, getActiveCompanies, getCompanyById } from '@/config/companies';

interface CompanyContextType {
  selectedCompany: Company | null;
  setSelectedCompany: (company: Company | null) => void;
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

  // 初期化（有効企業の読み込み＋前回選択の復元）
  useEffect(() => {
    try {
      setCompanies(getActiveCompanies());
      const savedId = localStorage.getItem('selectedCompanyId');
      if (savedId) {
        const saved = getCompanyById(savedId);
        if (saved && saved.isActive) setSelectedCompany(saved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '企業データの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 企業選択時にローカルストレージへ保存
  const handleSetSelectedCompany = (company: Company | null) => {
    setSelectedCompany(company);
    if (company) localStorage.setItem('selectedCompanyId', company.id);
    else localStorage.removeItem('selectedCompanyId');
  };

  const contextValue: CompanyContextType = {
    selectedCompany,
    setSelectedCompany: handleSetSelectedCompany,
    companies,
    isLoading,
    error,
  };

  return <CompanyContext.Provider value={contextValue}>{children}</CompanyContext.Provider>;
};

export const useCompany = (): CompanyContextType => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};
