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
  /** 企業を固定して開く（公開Q&Aページ #113 のように、その企業専用の画面で使う）。
   *  指定時は URL(?c=) や前回選択より優先する。 */
  initialCompanyId?: string;
}

export const CompanyProvider: React.FC<CompanyProviderProps> = ({ children, initialCompanyId }) => {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初期化。優先順位は URL(?c=) > 前回選択（localStorage）。
  // ?c= は公開Q&Aページ(#113)などからの送客用ディープリンク。企業を選び直させない。
  useEffect(() => {
    try {
      setCompanies(getActiveCompanies());
      const fromUrl = new URLSearchParams(window.location.search).get('c');
      // 優先順位: 固定指定（企業ページ） > URL(?c=) > 前回選択
      const target = initialCompanyId ?? fromUrl ?? localStorage.getItem('selectedCompanyId');
      if (target) {
        const found = getCompanyById(target);
        if (found?.isActive) {
          setSelectedCompany(found);
          // URL 由来の選択も次回のために保存する（挙動を localStorage 経路と揃える）。
          // 企業ページ由来（initialCompanyId）は「その場だけ」なので保存しない。
          if (!initialCompanyId && fromUrl) localStorage.setItem('selectedCompanyId', found.id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '企業データの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [initialCompanyId]);

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
