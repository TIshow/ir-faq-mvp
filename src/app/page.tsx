'use client';

import { useState } from 'react';
import SearchModal from '../components/SearchModal';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalQuery, setModalQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setModalQuery(searchQuery.trim());
      setIsModalOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full text-center">
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
            IR室ボット
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300">
            企業のIR情報について何でもお聞きください
          </p>
        </div>

        <form onSubmit={handleSearch} className="mb-8">
          <div className="relative max-w-2xl mx-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="IR情報について質問してください（例：売上高の推移について教えて）"
              className="w-full px-6 py-4 text-lg border-2 border-gray-300 dark:border-gray-600 rounded-full focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 shadow-lg"
            />
            <button
              type="submit"
              className="absolute right-2 top-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-6 py-2 transition-colors duration-200"
            >
              検索
            </button>
          </div>
        </form>

        <div className="text-sm text-gray-500 dark:text-gray-400">
          <p>Enterキーを押すか検索ボタンをクリックして検索を開始</p>
        </div>
      </div>

      <SearchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        query={modalQuery}
      />
    </div>
  );
}
