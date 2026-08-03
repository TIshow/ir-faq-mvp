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
 *
 * **公開ゲート**: 上記2・3と sitemap/llms.txt への掲載は `publishOfficialQa` が true の
 * 企業だけ。「公式」は発行体の承認を含意する表現なので、実際に話が進んでいる企業に限る。
 * false の企業もページ自体は動く（開発・デモ用）が noindex で、AIには案内しない。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ChatInterface from '@/components/ChatInterface';
import { CompanyPicker } from '@/components/CompanyPicker';
import { RememberCompany } from '@/components/RememberCompany';
import { BrandLogo } from '@/components/BrandLogo';
import { getActiveCompanies, companyShortName, type Company } from '@/config/companies';
import { companyHeadline, companyQa } from '@/lib/public-facts';

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
    // 公開を承認していない企業は noindex（ページ自体は開発・デモ用に動かしたまま）。
    // 「公式」は発行体の承認を含意するので、勝手にAI/検索へ載せない。
    ...(company.publishOfficialQa ? {} : { robots: { index: false, follow: false } }),
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
  const qa = companyQa(company);
  const headline = companyHeadline(company);

  // 機械専用の経路: schema.org/FAQPage に答え全文を入れる。
  // **公開を承認した企業だけ**（構造化データは「公式回答」の機械可読な主張そのもの）。
  const published = !!company.publishOfficialQa;
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    name: `${company.name}の公式Q&A`,
    mainEntity: qa.map((q) => ({
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
    <div className="relative flex h-screen flex-col bg-cream text-ink">
      {/* 「前回みていた銘柄」を覚える（トップの「続きから」が読む）。描画はしない */}
      <RememberCompany companyId={company.id} />

      {published && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
          />
        </>
      )}

      {/* このURLが何のページかを機械にも人（スクリーンリーダー）にも明示する。
          画面ではチャットの見出しが同じ役割を果たすので視覚的には出さない。 */}
      <h1 className="sr-only">
        {`${company.name}（証券コード ${ticker}）の公式Q&A — ${short}の開示済み情報にもとづく、出典つきの回答`}
      </h1>

      {/* Header。企業ピッカーのドロップダウンが本文の上に出るよう、
          チャット領域より高い z を持たせる。 */}
      <header className="relative z-30 flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <BrandLogo />
        <CompanyPicker selected={company} />
      </header>

      {/* z-index は付けない（理由は / と同じ: Q&Aパネルをヘッダーより上に出すため） */}
      <div className="relative flex-1 overflow-hidden">
        <ChatInterface company={company} headline={headline} qa={qa} />
      </div>
    </div>
  );
}
