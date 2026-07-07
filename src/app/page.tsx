import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';
import { AmbientBackground } from '@/components/AmbientBackground';

export default function Home() {
  return (
    <CompanyProvider>
      <div className="relative flex h-screen flex-col bg-[#0a0b0d] text-zinc-100">
        {/* 背景: 薄く流れるチャート＋グリッド（装飾のみ） */}
        <AmbientBackground />

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between gap-4 border-b border-zinc-900/80 bg-[#0a0b0d]/60 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 font-black text-emerald-400 ring-1 ring-emerald-500/30">
              IR
            </span>
            <span className="text-base font-semibold tracking-tight text-zinc-100">IR Agent</span>
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
