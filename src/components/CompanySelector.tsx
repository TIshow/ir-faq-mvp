'use client';

import React from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { Company } from '@/config/companies';

interface CompanySelectorProps {
  className?: string;
}

export const CompanySelector: React.FC<CompanySelectorProps> = ({ className = '' }) => {
  const { 
    selectedCompany, 
    setSelectedCompany, 
    companies, 
    isLoading, 
    error 
  } = useCompany();

  // ローディング状態
  if (isLoading) {
    return (
      <div className={`company-selector ${className}`}>
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600">企業情報を読み込み中...</span>
        </div>
      </div>
    );
  }

  // エラー状態
  if (error) {
    return (
      <div className={`company-selector ${className}`}>
        <div className="text-red-600 text-sm">
          ⚠️ {error}
        </div>
      </div>
    );
  }

  // 企業選択変更ハンドラー
  const handleCompanyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const companyId = event.target.value;
    if (companyId === '') {
      setSelectedCompany(null);
    } else {
      const company = companies.find(c => c.id === companyId);
      if (company) {
        setSelectedCompany(company);
      }
    }
  };

  return (
    <div className={`company-selector ${className}`}>
      <div className="flex flex-col space-y-2">
        <label htmlFor="company-select" className="text-sm font-medium text-gray-700">
          企業を選択してください
        </label>
        
        <select
          id="company-select"
          value={selectedCompany?.id || ''}
          onChange={handleCompanyChange}
          className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        >
          <option value="">-- 企業を選択してください --</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name} ({company.ticker})
            </option>
          ))}
        </select>
        
        {/* 選択された企業の詳細情報 */}
        {selectedCompany && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">
                    {selectedCompany.name.charAt(0)}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-gray-900">
                  {selectedCompany.name}
                </h3>
                <p className="text-xs text-gray-500">
                  {selectedCompany.nameEn}
                </p>
                {selectedCompany.sector && (
                  <p className="text-xs text-gray-500 mt-1">
                    業界: {selectedCompany.sector}
                  </p>
                )}
                {selectedCompany.description && (
                  <p className="text-xs text-gray-600 mt-1">
                    {selectedCompany.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// コンパクト版のセレクター（ヘッダー等で使用）
export const CompactCompanySelector: React.FC<CompanySelectorProps> = ({ className = '' }) => {
  const { selectedCompany, setSelectedCompany, companies } = useCompany();

  const handleCompanyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const companyId = event.target.value;
    if (companyId === '') {
      setSelectedCompany(null);
    } else {
      const company = companies.find(c => c.id === companyId);
      if (company) {
        setSelectedCompany(company);
      }
    }
  };

  return (
    <div className={`compact-company-selector ${className}`}>
      <select
        value={selectedCompany?.id || ''}
        onChange={handleCompanyChange}
        className="block w-full px-3 py-1 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">企業を選択</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </div>
  );
};

// 企業選択カード版（より視覚的なインターフェース）
export const CompanyCard: React.FC<{ company: Company; isSelected: boolean; onSelect: (company: Company) => void }> = ({ 
  company, 
  isSelected, 
  onSelect 
}) => {
  return (
    <div
      className={`company-card cursor-pointer border-2 rounded-lg p-4 transition-all duration-200 hover:shadow-md ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
      onClick={() => onSelect(company)}
    >
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          isSelected ? 'bg-blue-600' : 'bg-gray-400'
        }`}>
          <span className="text-white font-bold">
            {company.name.charAt(0)}
          </span>
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">
            {company.name}
          </h3>
          <p className="text-sm text-gray-500">
            {company.ticker} • {company.sector}
          </p>
        </div>
        {isSelected && (
          <div className="flex-shrink-0">
            <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// 企業選択カード一覧
export const CompanyCardSelector: React.FC<CompanySelectorProps> = ({ className = '' }) => {
  const { selectedCompany, setSelectedCompany, companies } = useCompany();

  return (
    <div className={`company-card-selector ${className}`}>
      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-900">
          企業を選択してください
        </h3>
        <div className="grid grid-cols-1 gap-3">
          {companies.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              isSelected={selectedCompany?.id === company.id}
              onSelect={setSelectedCompany}
            />
          ))}
        </div>
      </div>
    </div>
  );
};