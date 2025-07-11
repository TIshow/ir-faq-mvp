import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanySelector } from '@/components/CompanySelector';

export default function Home() {
  return (
    <CompanyProvider>
      <div className="min-h-screen bg-white dark:bg-gray-900">
        <div className="h-screen flex flex-col">
          {/* Header with Company Selector */}
          <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  IR FAQ Bot
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  企業のIR情報についてお答えします
                </p>
              </div>
              <div className="w-80">
                <CompanySelector />
              </div>
            </div>
          </header>
          
          {/* Main Chat Interface */}
          <div className="flex-1 overflow-hidden">
            <ChatInterface />
          </div>
        </div>
      </div>
    </CompanyProvider>
  );
}
