import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompactCompanySelector } from '@/components/CompanySelector';

export default function Home() {
  return (
    <CompanyProvider>
      <div className="h-screen flex flex-col bg-white dark:bg-gray-900">
        {/* スリムな単一ヘッダー: タイトル + コンパクトな企業セレクタ */}
        <header className="flex items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-700 px-4 py-2.5">
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white whitespace-nowrap">
              IR Agent
            </h1>
            <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400 truncate">
              企業のIR情報についてお答えします
            </span>
          </div>
          <div className="w-44 sm:w-64 shrink-0">
            <CompactCompanySelector />
          </div>
        </header>

        {/* Main Chat Interface */}
        <div className="flex-1 overflow-hidden">
          <ChatInterface />
        </div>
      </div>
    </CompanyProvider>
  );
}
