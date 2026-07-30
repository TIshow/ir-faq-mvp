/**
 * 銘柄URL（#113）— `/c/7561`
 *
 * **別UIの「銘柄ページ」は作らない**。投資家に見せたいのは今のチャットUIで十分で、
 * 数値の一覧だけなら四季報やIR Bankで足りる（我々の価値は「その先を対話で深掘り」）。
 * ここが独立したURLなのは、AIに引用させるために**銘柄ごとの安定したURL**が要るから。
 *   - トップ `/` は企業をクライアント側（localStorage / ?c=）で決めるため、
 *     クローラーが取得しても中身のないシェルになる＝GEOが成立しない。
 *   - このURLはサーバー側で企業を固定して描画するので、
 *     「ハークスレイの公式Q&A」として引用できる実体になる。
 *
 * したがって中身は `/` と同じチャットUI。違いは3つだけ:
 *   1. 企業がサーバーで固定されている（AI経由で来た人は選び直さなくていい）
 *   2. 公式Q&A（質問＋**答え全文**）がサイドパネルとしてHTMLに含まれる
 *      （閉じていてもHTMLにはある＝JSを実行しないクローラーが読める）
 *   3. JSON-LD(FAQPage) を持つ（機械専用の、曖昧さのない経路）
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ChatInterface from '@/components/ChatInterface';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CompanyPicker } from '@/components/CompanyPicker';
import { BrandLogo } from '@/components/BrandLogo';
import { getActiveCompanies, companyShortName, type Company } from '@/config/companies';
import { buildNumericQa, headlineNumbersByTicker, qaByTicker } from '@/lib/public-facts';

/** 静的生成（Phase 1: デプロイ時のみ生成・実行時のクエリはゼロ） */
export const dynamic = 'force-static';

export function generateStaticParams() {
  return getActiveCompanies()
    .filter((c) => c.ticker)
    .map((c) => ({ ticker: c.ticker }));
}

function findCompany(ticker: string): Company | undefined {
  return getActiveCompanies().find((c) => c.ticker === ticker);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const company = findCompany(ticker);
  if (!company) return { title: 'Naruhodo IR' };
  const short = companyShortName(company.name);
  return {
    title: `${short}（${ticker}）の公式Q&A｜Naruhodo IR`,
    description: `${company.name}の開示済み情報にもとづく公式Q&A。出典つきで、さらに詳しくは対話で質問できます。`,
  };
}

export default async function CompanyChatPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const company = findCompany(ticker);
  if (!company) notFound();

  const short = companyShortName(company.name);
  // この企業ぶんだけをサーバーで用意する＝このURLのHTMLに答え全文が載る
  const qa = qaByTicker([company]);
  const headline = headlineNumbersByTicker([ticker]);

  // 機械専用の経路: schema.org/FAQPage に答え全文を入れる
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    name: `${company.name}の公式Q&A`,
    mainEntity: buildNumericQa(ticker, company.fiscalYearEndMonth).map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.name,
    alternateName: company.nameEn,
    tickerSymbol: ticker,
    description: company.description,
    url: company.websiteUrl,
  };

  return (
    <CompanyProvider initialCompanyId={company.id}>
      <div className="relative flex h-screen flex-col bg-cream text-ink">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />

        {/* このURLが何のページかを機械にも人（スクリーンリーダー）にも明示する。
            画面ではチャットの見出しが同じ役割を果たすので視覚的には出さない。 */}
        <h1 className="sr-only">
          {`${company.name}（証券コード ${ticker}）の公式Q&A — ${short}の開示済み情報にもとづく、出典つきの回答`}
        </h1>

        {/* Header。企業ピッカーのドロップダウンが本文の上に出るよう、
            チャット領域より高い z を持たせる。 */}
        <header className="relative z-30 flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <BrandLogo />
          <CompanyPicker />
        </header>

        {/* z-index は付けない（理由は / と同じ: Q&Aパネルをヘッダーより上に出すため） */}
        <div className="relative flex-1 overflow-hidden">
          <ChatInterface headline={headline} qa={qa} />
        </div>
      </div>
    </CompanyProvider>
  );
}
