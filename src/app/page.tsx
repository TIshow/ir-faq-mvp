import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';
import { BrandLogo } from '@/components/BrandLogo';
import { getActiveCompanies } from '@/config/companies';
import { headlineNumbersByTicker } from '@/lib/public-facts';

export default function Home() {
  // トップ画面では企業の選択がクライアント側で決まるため、全社ぶんの「おもな数字」を
  // サーバで用意して渡す（1社あたり数項目なのでペイロードは小さい）。
  const headline = headlineNumbersByTicker(
    getActiveCompanies()
      .map((c) => c.ticker)
      .filter((t): t is string => !!t),
  );

  return (
    <CompanyProvider>
      <div className="relative flex h-screen flex-col bg-cream text-ink">
        {/* Header */}
        <header className="relative z-10 flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <BrandLogo />
          <CompanyPicker />
        </header>

        {/* Main Chat */}
        <div className="relative z-10 flex-1 overflow-hidden">
          <ChatInterface headline={headline} />
        </div>
      </div>
    </CompanyProvider>
  );
}
