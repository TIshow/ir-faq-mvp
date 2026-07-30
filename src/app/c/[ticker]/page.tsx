/**
 * 公開Q&Aページ（#113）— `/c/7561`
 *
 * **一次読者はAIのクローラー**。人間には「入口」として機能させる。
 * したがって:
 *  - **サーバー側で完全に描画**する（クローラーはJSを実行しない）
 *  - **答えは必ずHTMLに全文**含める（質問だけでは引用されない＝本機能の目的が消える）
 *  - JSON-LD(FAQPage) にも同じQ&Aを入れる（機械専用の、曖昧さのない経路）
 *
 * 掲載するのは層1（XBRL検証済み）由来の決定論Q&Aのみ。LLMは一切通さない。
 * 財務データページにはしない（時系列・比較・スクリーニングはIR Bank等の領域）。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getActiveCompanies, companyShortName, type Company } from '@/config/companies';
import { BrandLogo } from '@/components/BrandLogo';
import { CompanyProvider } from '@/contexts/CompanyContext';
import ChatInterface from '@/components/ChatInterface';
import { buildNumericQa, latestHeadlineFacts, formatValue, periodLabel } from '@/lib/public-facts';

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

export default async function CompanyQaPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const company = findCompany(ticker);
  if (!company) notFound();

  const short = companyShortName(company.name);
  const qa = buildNumericQa(ticker, company.fiscalYearEndMonth);
  const headline = latestHeadlineFacts(ticker);
  const latestPeriod = headline[0]
    ? periodLabel(headline[0].period_label, company.fiscalYearEndMonth)
    : '';

  // 機械専用の経路: schema.org/FAQPage に答え全文を入れる
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
    <div className="mx-auto min-h-screen w-full max-w-3xl px-5 py-8 text-ink">
      {/* JSON-LD（答え全文を含む・レイアウト変更の影響を受けない機械向け経路） */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />

      <header>
        <Link href="/" className="inline-block">
          <BrandLogo markHeight={26} />
        </Link>
        <h1 className="font-round mt-5 text-[26px] font-black leading-snug tracking-tight text-ink">
          {`${short}（${ticker}）の公式Q&A`}
        </h1>
        {/* 正式名称も本文に置く（「株式会社ハークスレイ 営業利益」のような検索/照合に効く） */}
        <p className="mt-2.5 text-sm font-medium leading-relaxed text-ink-soft">
          {`${company.name}（証券コード ${ticker}）${company.description ? ` — ${company.description}` : ''}`}
        </p>
      </header>

      {/* 公式Q&A — このページの主役。答えは全文をHTMLに置く */}
      <section className="mt-8">
        <h2 className="font-round text-[15px] font-black text-ink">公式Q&amp;A</h2>
        {qa.length === 0 ? (
          <p className="mt-3 text-sm font-medium text-ink-soft">
            この銘柄はまだ公開できる回答が準備できていません。下のチャットから質問できます。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {qa.map((q) => (
              <li
                key={q.id}
                id={q.id}
                className="scroll-mt-4 rounded-3xl bg-paper p-5 shadow-e2"
              >
                <h3 className="font-round text-[14px] font-black leading-relaxed text-ink">
                  {q.question}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.95] text-ink-soft">{q.answer}</p>
                {/* 出典は1つのテキストノードとして出す（Reactが隣接ノード間に差し込む
                    <!-- --> を避け、機械が素直に抽出できるようにする） */}
                <p className="mt-3 border-t-2 border-dashed border-line pt-2.5 text-[10.5px] font-bold text-mute">
                  {`出典：${q.source.doc}${q.source.page ? ` p.${q.source.page}` : ''}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 参考：直近期の主要数値 — 脇役。データ表としては見せない */}
      {headline.length > 0 && (
        <section className="mt-6">
          <h2 className="font-round text-[13px] font-black text-mute">
            {`参考：${latestPeriod}の主要数値`}
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {headline.map((f) => (
              <div key={f.metric_key} className="rounded-2xl bg-paper p-4 shadow-e2">
                <dt className="text-[10.5px] font-bold text-mute">{f.metric_label_ja}</dt>
                <dd className="font-num mt-1 text-[19px] font-bold leading-none text-ink">
                  {formatValue(f.value_numeric, f.unit)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* もっと詳しく聞く＝チャット本体。
          投資家がこのページに来る理由は「数字を見る」ではなく「その先を知りたい」から
          （数字だけなら四季報で足りる）。したがってチャットはリンク先の予備機能ではなく、
          このページに全幅で置く。入力バーは画面下端に貼り付き、常に「聞ける状態」で見えている。 */}
      <section className="mt-10 border-t-2 border-dashed border-line pt-8">
        <h2 className="font-round text-[15px] font-black text-ink">もっと詳しく聞く</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          「なぜ増益なのか」「セグメントごとの背景は」など、開示資料にもとづいて対話で深掘りできます。
        </p>
      </section>
      <CompanyProvider initialCompanyId={company.id}>
        <ChatInterface variant="page" />
      </CompanyProvider>

      <footer className="mt-6 px-4 text-[10.5px] leading-relaxed text-mute">
        <p>
          本ページは開示済み情報の再掲です。投資判断の助言・将来予測・未開示情報は含みません。
          最新かつ正式な情報は各社の適時開示・法定開示をご確認ください。
        </p>
      </footer>
    </div>
  );
}
