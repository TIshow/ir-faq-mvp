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

/** 固定指定された企業を**同期的に**解決する（静的configなのでサーバーでも引ける）。 */
function resolveInitial(initialCompanyId?: string): Company | null {
  if (!initialCompanyId) return null;
  const found = getCompanyById(initialCompanyId);
  return found?.isActive ? found : null;
}

export const CompanyProvider: React.FC<CompanyProviderProps> = ({ children, initialCompanyId }) => {
  // 銘柄URL（/c/7561）では企業を**初回レンダリング時点で**確定させる。
  // useEffect で後から入れると SSR のHTMLが「企業未選択」の状態になり、公式Q&Aが
  // HTMLに載らない＝JSを実行しないAIクローラーから中身が見えなくなる（#113 の目的が消える）。
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(() =>
    resolveInitial(initialCompanyId),
  );
  // 企業マスターは静的configなのでサーバーでもそのまま引ける（ピッカーもSSRされる）
  const [companies] = useState<Company[]>(() => getActiveCompanies());
  const [isLoading, setIsLoading] = useState(!initialCompanyId);
  const [error, setError] = useState<string | null>(null);

  // ブラウザにしか無い情報（URL・localStorage）だけを後から反映する。
  // 優先順位: 固定指定（銘柄URL） > URL(?c=) > 前回選択。
  useEffect(() => {
    if (initialCompanyId) return; // 固定指定が最優先。上書きしない
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('c');
      const target = fromUrl ?? localStorage.getItem('selectedCompanyId');
      if (target) {
        const found = getCompanyById(target);
        if (found?.isActive) {
          setSelectedCompany(found);
          // URL 由来の選択も次回のために保存する（挙動を localStorage 経路と揃える）
          if (fromUrl) localStorage.setItem('selectedCompanyId', found.id);
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
