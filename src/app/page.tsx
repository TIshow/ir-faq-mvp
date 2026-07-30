import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';
import { BrandLogo } from '@/components/BrandLogo';
import { getActiveCompanies } from '@/config/companies';
import { headlineNumbersByTicker, qaByTicker } from '@/lib/public-facts';

export default function Home() {
  // トップ画面では企業の選択がクライアント側で決まるため、全社ぶんの「おもな数字」と
  // 公式Q&Aをサーバで用意して渡す（全社あわせて数KBなのでペイロードは小さい）。
  const companies = getActiveCompanies();
  const headline = headlineNumbersByTicker(
    companies.map((c) => c.ticker).filter((t): t is string => !!t),
  );
  const qa = qaByTicker(companies);

  return (
    <CompanyProvider>
      <div className="relative flex h-screen flex-col bg-cream text-ink">
        {/* Header。企業ピッカーのドロップダウンが本文の上に出るよう、
            チャット領域より高い z を持たせる（同じ z だと後続の兄弟が上に乗り、
            ドロップダウンがクリックできなくなる）。 */}
        <header className="relative z-30 flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <BrandLogo />
          <CompanyPicker />
        </header>

        {/* Main Chat。z-index は付けない: ここで積み重ねコンテキストを作ると、
            中のQ&Aパネル(z-50)がヘッダー(z-30)より上に出られなくなる。
            ピッカーのドロップダウンはヘッダー側の z-30 が勝つので従来どおり見える。 */}
        <div className="relative flex-1 overflow-hidden">
          <ChatInterface headline={headline} qa={qa} />
        </div>
      </div>
    </CompanyProvider>
  );
}
