import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';

export default function Home() {
  return (
    <CompanyProvider>
      <div className="relative flex h-screen flex-col bg-cream text-ink">
        {/* Header */}
        <header className="relative z-10 flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="font-round grid h-9 w-9 place-items-center rounded-full bg-pop text-[13px] font-black text-cream">
              IR
            </span>
            <span className="font-round text-[17px] font-black tracking-tight text-ink">IR Agent</span>
          </div>
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
