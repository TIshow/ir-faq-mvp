'use client';

import { useState, useEffect } from 'react';

interface SearchResult {
  id: string;
  document: {
    id: string;
    structData: {
      question?: string;
      answer?: string;
      title?: string;
    };
  };
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
}

export default function SearchModal({ isOpen, onClose, query }: SearchModalProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && query) {
      searchVertexAI(query);
    }
  }, [isOpen, query]);

  const searchVertexAI = async (searchQuery: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: searchQuery }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-semibold">IR FAQ 検索結果</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            検索クエリ: &quot;{query}&quot;
          </p>
          
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3">検索中...</span>
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-4">
              {results.map((result, index) => (
                <div key={result.id || index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="font-semibold text-lg mb-2 text-blue-700 dark:text-blue-400">
                    Q: {result.document.structData.question || result.document.structData.title || 'タイトルなし'}
                  </h3>
                  <div className="text-gray-700 dark:text-gray-300">
                    <strong>A:</strong> {result.document.structData.answer || '回答がありません'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              検索結果が見つかりませんでした。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}