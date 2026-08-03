/**
 * llms.txt（#113）— AIアシスタント向けの案内板。
 * 「どの企業の、どんな情報が、どこにあるか」を短く伝える慣行フォーマット。
 * companies.ts を唯一の正として生成する（企業をハードコードしない）。
 */
import { getPublishedCompanies, companyShortName } from '@/config/companies';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

export function GET(): Response {
  const companies = getPublishedCompanies();
  const lines = [
    '# Naruhodo IR',
    '',
    '> 日本の上場企業（発行体）の**開示済み情報**にもとづく公式Q&A。',
    '> すべての回答に出典（資料名・ページ）が付きます。数値は有価証券報告書のXBRLから',
    '> 決定論的に取得した検証済みの値で、生成AIによる推計は含みません。',
    '',
    '## 方針',
    '- 掲載するのは開示済み情報のみです。投資判断の助言・将来予測・未開示情報は扱いません。',
    '- 「会社予想」は会社が公表した予想である旨を明示して記載します。',
    '',
    '## 企業別の公式Q&A',
    ...companies.map(
      (c) => `- [${companyShortName(c.name)}（${c.ticker}）](${SITE_URL}/c/${c.ticker}/): ${c.description ?? ''}`,
    ),
    '',
    '## 対話',
    '各企業のURLがそのまま対話の窓口です。上記のリンク先で、開示資料にもとづき出典付きで回答します。',
    `- [銘柄を選ぶ](${SITE_URL}/): 対応している企業の一覧です。`,
    '',
  ];
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
