import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';

export default function Home() {
  return (
    <CompanyProvider>
      <div className="flex h-screen flex-col bg-[#0a0b0d] text-zinc-100">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 border-b border-zinc-900 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 font-black text-emerald-400 ring-1 ring-emerald-500/30">
              IR
            </span>
            <span className="text-base font-semibold tracking-tight text-zinc-100">IR Agent</span>
          </div>
          <CompanyPicker />
        </header>

        {/* Main Chat */}
        <div className="flex-1 overflow-hidden">
          <ChatInterface />
        </div>
      </div>
    </CompanyProvider>
  );
}
