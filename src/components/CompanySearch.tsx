'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { companyShortName } from '@/config/companies';
import { CHIP_TICKER } from '@/components/ui';
import { TierBadge } from '@/components/TierBadge';
import type { CompanyHit } from '@/app/api/companies/search/route';

/**
 * 社名・証券コードで銘柄を探す（#154 の続き）。
 *
 * **一覧ではなく検索**なのは、対象が上場3,829社だから。カードで並べる案は元から
 * 成立せず、レジストリ562KBをクライアントに配ることもできない（→ `/api/companies/search`）。
 *
 * トップ（大きい入力欄）と銘柄URLのピッカー（コンパクト）の両方で使う。
 */

/** 見え方の違いはここだけ。呼び出し側の条件分岐を増やさない。 */
const SKIN = {
  hero: {
    box: 'px-5 py-3 shadow-e2',
    icon: 'h-[18px] w-[18px]',
    input: 'text-[14px]',
    // トップでは候補が下のカードに重なるので浮かせる
    list: 'absolute left-0 right-0 z-40 mt-2 rounded-3xl border border-line bg-paper shadow-e4',
  },
  compact: {
    box: 'px-3.5 py-2 shadow-e1',
    icon: 'h-4 w-4',
    input: 'text-[13px]',
    // ピッカーの中では自分が既に浮いた面の上に居るので、流し込みで足りる
    list: 'mt-1.5 rounded-2xl',
  },
} as const;

export interface CompanySearchProps {
  /** 入力欄の見え方。トップ＝`hero` / ピッカー内＝`compact` */
  variant?: keyof typeof SKIN;
  placeholder?: string;
  autoFocus?: boolean;
  /** 銘柄を選んだとき（ピッカーを閉じる等）。遷移自体はこの中で行う */
  onPicked?: () => void;
}

export function CompanySearch({
  variant = 'hero',
  placeholder = '社名・証券コードで検索',
  autoFocus = false,
  onPicked,
}: CompanySearchProps) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const skin = SKIN[variant];

  // **応答の追い越しを防ぐ。** 入力のたびに投げるので、遅い前の結果が後から
  // 届いて新しい結果を上書きしうる。連番で自分が最新かを確かめてから反映する。
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const ac = new AbortController();
    // 打鍵ごとに投げない（150ms 止まってから）
    const timer = setTimeout(async () => {
      try {
        // 末尾スラッシュ必須（next.config の `trailingSlash: true`）。
        // 付けないと 308 を挟むぶん打鍵ごとに往復が1回増える。
        const r = await fetch(`/api/companies/search/?q=${encodeURIComponent(term)}`, {
          signal: ac.signal,
        });
        const data = (await r.json()) as { results?: CompanyHit[] };
        if (mine !== seq.current) return;
        setHits(data.results ?? []);
        setCursor(0);
      } catch {
        // 中断・通信断は「候補が出ない」だけ。入力は妨げない
        if (mine === seq.current) setHits([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q]);

  const go = (hit: CompanyHit) => {
    onPicked?.();
    router.push(`/c/${hit.ticker}/`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) {
      e.preventDefault();
      setCursor((i) => (i + move + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[cursor]);
    } else if (e.key === 'Escape') {
      setQ('');
    }
  };

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-full bg-paper ${skin.box}`}>
        <svg
          className={`${skin.icon} shrink-0 text-mute`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.08 3.08a1 1 0 01-1.42 1.42l-3.08-3.08A7 7 0 012 9z"
            clipRule="evenodd"
          />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label="社名または証券コードで銘柄を検索"
          // 候補リストを持つ入力なので combobox。`textbox`（input の暗黙ロール）のままだと
          // aria-expanded が効かず、候補が出ていることを支援技術に伝えられない。
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={hits.length > 0}
          className={`w-full bg-transparent font-medium text-ink outline-none placeholder:text-mute ${skin.input}`}
        />
        {loading && (
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-pop"
            aria-hidden="true"
          />
        )}
      </div>

      {q.trim() && !loading && !hits.length && (
        <p className="mt-2.5 px-1 text-[11.5px] font-medium text-mute">
          該当する銘柄が見つかりませんでした。証券コード（例 7203）でもお試しください。
        </p>
      )}

      {hits.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className={`${skin.list} max-h-[19rem] overflow-y-auto p-1.5`}
        >
          {hits.map((h, i) => (
            <li key={h.ticker}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(h)}
                className={`flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition ${
                  i === cursor ? 'bg-cream' : 'hover:bg-cream/60'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold text-ink">
                      {companyShortName(h.name)}
                    </span>
                    {/* **公式だけを目印に出す。** 3,829件中3,825件が非公式なので、
                        既定を全行に書いても選ぶ助けにならない（TierBadge 参照）。 */}
                    {h.official && <TierBadge official size="sm" />}
                  </span>
                  {h.sector && (
                    <span className="block truncate text-[11px] text-mute">{h.sector}</span>
                  )}
                </span>
                <span className={CHIP_TICKER}>{h.ticker}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
