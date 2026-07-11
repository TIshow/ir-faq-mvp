import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';
import { BrandLogo } from '@/components/BrandLogo';

export default function Home() {
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
          <ChatInterface />
        </div>
      </div>
    </CompanyProvider>
  );
}
