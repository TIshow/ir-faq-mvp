/**
 * トップ（`/`）＝ **銘柄を選ぶ入口**。ここでは対話しない。
 *
 * 対話は `/c/<ticker>` でだけ起きる。理由:
 *   - 会話しているURLがそのまま共有・引用できる（`/` で話すと、URLを渡した相手には
 *     その人のブラウザに残っている別の銘柄が開いてしまう）
 *   - 同じチャットが2つのURLにあるとAIから見た「答えの正しい置き場」が曖昧になる
 *
 * 将来ここは**複数銘柄をまたぐ総合窓口**にする（横断チャット）。
 * その入力欄は横断チャットが動くようになってから足す。使えない入力欄を先に置くと
 * 「壊れている」ようにしか見えないため。
 */
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { CompanyEntry } from '@/components/CompanyEntry';
import { CompanySearch } from '@/components/CompanySearch';
import {
  getActiveCompanies,
  getPublishedCompanies,
  companyShortName,
  isCustomerCompany,
} from '@/config/companies';
import { headlineNumbersByTicker } from '@/lib/public-facts';
import { searchableCompanyCount } from '@/lib/listed-companies';

export default function Home() {
  // 一覧には対応中の全社を出す（人が選べないと使えない）。
  // ただし**数字と「公式Q&A N件」は公開を承認した企業だけ**。このページは index 可能で
  // sitemap にも載るため、ここに出すと銘柄ページのゲートを迂回して主張が外へ出る。
  const companies = getActiveCompanies().filter((c) => c.ticker);
  const headline = headlineNumbersByTicker(getPublishedCompanies());
  // 上場全社が検索で引ける（#154）。数字は実データから数える＝手で書かない
  const searchable = searchableCompanyCount();

  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="mx-auto flex w-full max-w-4xl items-center px-5 py-3.5 sm:px-6">
        <BrandLogo />
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-4 sm:px-6">
        <h1 className="font-round text-[28px] font-black leading-[1.45] tracking-tight text-ink sm:text-[34px]">
          どの会社の IR に <span className="mk">なるほど！</span>する？
        </h1>
        <p className="mt-3 text-[12.5px] font-medium leading-[1.9] text-ink-soft">
          会社を選ぶと、その会社の開示資料だけを根拠に、出典つきで対話できます。
        </p>

        <div className="mt-5">
          <CompanySearch placeholder="社名・証券コードで検索（例: トヨタ、7203）" />
          <p className="mt-2 px-1 text-[11px] font-medium text-mute">
            {`上場${searchable.toLocaleString()}社から探せます。`}
          </p>
        </div>

        <CompanyEntry />

        {/* この一覧は `companies.ts` の企業＝顧客とは限らない（動作確認用の 4063 も居る）。
            「公式IR」を名乗れるのは顧客だけなので、見出しでは主張せずカード側にバッジを出す。 */}
        <h2 className="font-round mt-9 text-[15px] font-black text-ink">一覧から選ぶ</h2>
        <ul className="mt-3.5 grid gap-3 sm:grid-cols-2">
          {companies.map((c) => {
            const h = c.ticker ? headline[c.ticker] : undefined;
            return (
              <li key={c.id}>
                <Link
                  href={`/c/${c.ticker}/`}
                  className="group flex h-full flex-col rounded-3xl bg-paper p-5 shadow-e2 transition-transform duration-200 hover:-translate-y-1 hover:shadow-e3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-round text-[17px] font-black text-ink">
                      {companyShortName(c.name)}
                    </span>
                    <span className="font-num text-[12px] font-semibold text-mute">{c.ticker}</span>
                    {isCustomerCompany(c) && (
                      <span className="rounded-full bg-pop-soft px-1.5 py-px text-[9.5px] font-black text-ink">
                        公式IR
                      </span>
                    )}
                  </div>
                  {c.description && (
                    <p className="mt-1.5 text-[11.5px] leading-[1.8] text-ink-soft">
                      {c.description}
                    </p>
                  )}

                  {/* 層1（XBRL検証済み）がある会社だけ、直近の数字をひとこと添える */}
                  {h && h.numbers[0] && (
                    <p className="font-num mt-3 text-[12px] font-semibold text-mute">
                      {`${h.period} ${h.numbers[0].label} `}
                      <span className="text-[15px] font-bold text-ink">{h.numbers[0].value}</span>
                      {h.numbers[0].yoy && (
                        <span
                          className={`ml-1.5 text-[11px] font-bold ${
                            h.numbers[0].yoy.startsWith('+') ? 'text-pop' : 'text-coral-deep'
                          }`}
                        >
                          {h.numbers[0].yoy}
                        </span>
                      )}
                    </p>
                  )}

                  <span className="mt-4 inline-flex items-center gap-1 text-[11.5px] font-bold text-pop-deep">
                    {h ? `質問する・公式Q&A ${h.qaCount}件 →` : '質問する →'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-9 text-[10.5px] leading-relaxed text-mute">
          複数の会社をまたいで質問できる窓口は準備中です。
          <br />
          開示済み情報のみを根拠に回答します。投資判断の助言・将来予測は行いません。
        </p>
      </main>
    </div>
  );
}
