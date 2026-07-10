'use client';

import React, { useEffect, useState } from 'react';
import { AgentResponse, Citation, FactCard, ScopeStatus } from '@/lib/agent-types';
import { Markdown } from '@/components/Markdown';

/**
 * gs:// の出典URLを、署名URLを発行する内部ルート /api/doc?... に変換する。
 * （非公開バケットのまま、クリック時に時限・署名URLでPDFを開く。ページ指定も付与）
 * 既に http(s):// なら従来どおり #page=N を付けて返す。
 */
function toDocHref(citation: Citation): string | undefined {
  const url = citation.url;
  if (!url) return undefined;
  if (!url.startsWith('gs://')) {
    return citation.page ? `${url}#page=${citation.page}` : url;
  }
  const rest = url.slice('gs://'.length); // bucket/object…
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  const params = new URLSearchParams({ b: rest.slice(0, slash), o: rest.slice(slash + 1) });
  // trailingSlash:true のため末尾スラッシュ。ページ指定はフラグメントでPDFビューアが解釈
  const frag = citation.page ? `#page=${citation.page}` : '';
  return `/api/doc/?${params.toString()}${frag}`;
}

/** 出典リンク：原本PDFの該当ページへ署名URL経由でディープリンク（クリームのチップ） */
export const CitationLink: React.FC<{ citation: Citation; compact?: boolean }> = ({ citation, compact }) => {
  const label = citation.page ? `${citation.doc} p.${citation.page}` : citation.doc;
  const href = toDocHref(citation);
  const cls = `inline-flex items-center gap-1 rounded-lg bg-cream px-2.5 py-1 font-bold text-mute transition hover:text-pop-deep ${
    compact ? 'text-[9.5px]' : 'text-[10.5px]'
  }`;
  const content = <span title={citation.quote ?? undefined}>出典：{label}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>
  ) : (
    <span className={cls}>{content}</span>
  );
};

/** C1: 数値のカウントアップ。表示のみの演出で、最終フレームは必ずサーバ整形済みの
 * 正確な文字列（fact.value から単位を除いた数字部）に着地させる＝決定論の見た目を一切変えない。
 * prefers-reduced-motion では即座に最終値を表示。 */
function useCountUp(target: number, unit: string, finalText: string, duration = 700): string {
  const [display, setDisplay] = useState(finalText);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const fmt = (v: number) =>
      unit === '%' ? v.toFixed(1) : Math.round(v).toLocaleString('ja-JP');
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setDisplay(p >= 1 ? finalText : fmt(target * ease(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return display;
}

/** fact.value（"3,057百万円"）を数字部と単位部に分け、大小のタイポで描画できるようにする */
function splitValue(fact: FactCard): { num: string; unit: string } {
  const v = fact.value;
  const i = v.search(/[^\d,.\-△+%]/);
  if (i < 0) return { num: v, unit: '' };
  if (i === 0) return { num: v, unit: '' };
  return { num: v.slice(0, i), unit: v.slice(i) };
}

const yoyUp = (f: FactCard) => !!f.yoy?.startsWith('+');
const yoyDown = (f: FactCard) => !!(f.yoy?.startsWith('-') || f.yoy?.startsWith('△'));

/* ------------------------------------------------------------------ *
 *  トレンドカード（評決カード）
 *  同一指標のカードが複数期あるとき、1枚の「大きな数字＋棒グラフ」に自動集約する。
 *  値・期間・YoYはすべて層1由来（コード計算済み）＝チャートも決定論。
 * ------------------------------------------------------------------ */
const TrendCard: React.FC<{ series: FactCard[] }> = ({ series }) => {
  // 実績を期間昇順で並べ、末尾に会社予想（あれば）
  const actuals = series.filter((f) => f.basis === 'actual').sort((a, b) => a.period.localeCompare(b.period));
  const forecasts = series.filter((f) => f.basis === 'forecast').sort((a, b) => a.period.localeCompare(b.period));
  const ordered = [...actuals, ...forecasts];
  const hero = actuals[actuals.length - 1] ?? ordered[ordered.length - 1];
  const { num, unit } = splitValue(hero);
  const animated = useCountUp(hero.valueNumeric, hero.unit, num);
  const max = Math.max(...ordered.map((f) => Math.abs(f.valueNumeric)), 1);

  // 出典（重複除去）
  const seen = new Set<string>();
  const sources = ordered
    .map((f) => f.source)
    .filter((s) => {
      const k = `${s.doc}#${s.page}`;
      if (!s.doc || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  return (
    <div className="relative rounded-3xl bg-paper p-5 shadow-[0_10px_30px_rgba(38,35,29,0.09)]">
      {/* 指標ピル */}
      <div className="inline-block rounded-full bg-pop/10 px-2.5 py-1 text-[10px] font-bold text-pop">
        {hero.metric} · {hero.period} {hero.basis === 'forecast' ? '会社予想' : '実績'}
      </div>

      {/* 大きな数字＋YoY */}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-2">
        <span className="font-num text-[42px] font-extrabold leading-none tracking-tight text-ink">{animated}</span>
        <span className="text-[13px] font-bold text-mute">{unit || hero.unit}</span>
        {hero.yoy && (
          <span
            className={`font-num animate-pop-in rounded-full px-2.5 py-1 text-[12.5px] font-bold text-white ${
              yoyDown(hero) ? 'bg-coral' : 'bg-pop'
            }`}
            style={{ animationDelay: '500ms' }}
          >
            {hero.yoy} {yoyUp(hero) ? '↑' : yoyDown(hero) ? '↓' : ''}
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] font-medium text-mute">{hero.consolidated ? '連結' : '単体'}</div>

      {/* 棒グラフ（高さ＝実データ比。会社予想は点線枠） */}
      <div className="mt-4 flex items-end gap-4 px-1" style={{ height: 108 }}>
        {ordered.map((f, i) => {
          const isForecast = f.basis === 'forecast';
          const isHero = f === hero;
          const h = Math.max(16, Math.round((Math.abs(f.valueNumeric) / max) * 72));
          return (
            <div key={`${f.period}-${f.basis}-${i}`} className="flex h-full flex-1 flex-col justify-end gap-1.5">
              <div
                className={`font-num text-center text-[11px] ${
                  isForecast ? 'font-semibold text-sun-deep' : isHero ? 'font-bold text-pop' : 'font-semibold text-mute'
                }`}
              >
                {splitValue(f).num}
              </div>
              <div
                className={`animate-bar-grow rounded-t-full ${
                  isForecast ? 'border-2 border-dashed border-sun-line bg-sun/15' : isHero ? 'bg-pop' : 'bg-line'
                }`}
                style={{ height: h, animationDelay: `${150 + i * 120}ms` }}
              />
              <div
                className={`text-center text-[10px] ${
                  isForecast ? 'font-bold text-sun-deep' : isHero ? 'font-black text-ink' : 'font-bold text-mute'
                }`}
              >
                {f.period}
                {isForecast ? '（予）' : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* 出典 */}
      {sources.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t-2 border-dashed border-line pt-3">
          {sources.map((s, i) => (
            <CitationLink key={i} citation={s} compact />
          ))}
        </div>
      )}
    </div>
  );
};

/** 数値カード（層1由来・単発）。出典の無いカードは描画しない。予想は点線枠＋会社予想バッジ。 */
export const FactCardView: React.FC<{ fact: FactCard }> = ({ fact }) => {
  // Hooks は早期 return より前に無条件で呼ぶ（rules-of-hooks）
  const { num, unit } = splitValue(fact);
  const animatedValue = useCountUp(fact.valueNumeric, fact.unit, num);
  if (!fact.source || !fact.source.doc) return null;
  const isForecast = fact.basis === 'forecast';

  return (
    <div
      className={`h-full rounded-2xl bg-paper p-4 shadow-[0_8px_22px_rgba(38,35,29,0.07)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(38,35,29,0.12)] ${
        isForecast ? 'border-2 border-dashed border-sun-line' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10.5px] font-bold ${isForecast ? 'text-sun-deep' : 'text-mute'}`}>{fact.metric}</span>
        {isForecast && (
          <span className="shrink-0 rounded-full bg-sun/25 px-1.5 py-0.5 text-[9.5px] font-bold text-sun-deep">
            会社予想
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`font-num text-[22px] font-bold leading-none ${isForecast ? 'text-sun-deep' : 'text-ink'}`}>
          {animatedValue}
        </span>
        <span className="text-[11px] font-bold text-mute">{unit || fact.unit}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-num text-[11px] font-semibold text-mute">{fact.period}</span>
        {fact.yoy && (
          <span
            style={{ animationDelay: '450ms' }}
            className={`font-num animate-pop-in text-[11px] font-bold ${
              yoyUp(fact) ? 'text-pop-deep' : yoyDown(fact) ? 'text-coral-deep' : 'text-mute'
            }`}
          >
            {yoyUp(fact) ? '▲' : yoyDown(fact) ? '▼' : ''}{fact.yoy} YoY
          </span>
        )}
      </div>

      <div className="mt-2.5 border-t-2 border-dashed border-line pt-2">
        <CitationLink citation={fact.source} compact />
      </div>
    </div>
  );
};

type ContactStatus = 'sending' | 'sent' | 'error' | undefined;

const ScopeNotice: React.FC<{
  status: ScopeStatus;
  reason?: string | null;
  contactStatus?: ContactStatus;
  onContactIR?: () => void;
}> = ({ status, reason, contactStatus, onContactIR }) => {
  if (status === 'answered') return null;
  if (status === 'refused') {
    // 誹謗中傷の拒否は本文(answer_prose)で丁重に断っており、助言/未開示の注記は出さない。
    if (reason === 'inappropriate') return null;
    return (
      <div className="mt-1 text-xs font-medium text-mute">
        ※ 投資判断の助言や未開示情報にはお答えできません。開示済みの事実についてお尋ねください。
      </div>
    );
  }

  if (contactStatus === 'sent') {
    // 完了: 落ち着いた成功カード（非ブロッキング・文脈内インライン）
    return (
      <div className="mt-1 flex items-start gap-2.5 rounded-2xl bg-pop/10 px-4 py-3">
        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-pop text-[10px] font-bold text-white">
          ✓
        </span>
        <div className="text-xs leading-relaxed">
          <p className="font-bold text-pop-deep">IR窓口へお取り次ぎしました</p>
          <p className="font-medium text-ink-soft">担当者が内容を確認します。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 rounded-2xl bg-paper p-4 shadow-[0_8px_22px_rgba(38,35,29,0.07)]">
      <p className="mb-2.5 text-xs font-medium leading-relaxed text-ink-soft">
        この質問は開示資料に見当たりませんでした。IR窓口にお取り次ぎできます。
      </p>
      <button
        onClick={onContactIR}
        disabled={contactStatus === 'sending'}
        className="inline-flex items-center gap-1.5 rounded-full bg-pop px-4 py-2 text-xs font-bold text-white transition hover:bg-pop-deep disabled:cursor-not-allowed disabled:opacity-70"
      >
        {contactStatus === 'sending' ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            送信中…
          </>
        ) : (
          'IR窓口へ問い合わせる →'
        )}
      </button>
      {contactStatus === 'error' && (
        <p className="mt-1.5 text-xs font-bold text-coral-deep">送信に失敗しました。もう一度お試しください。</p>
      )}
    </div>
  );
};

/**
 * カードの集約計画:
 *  - 先頭カードと同じ指標(metricKey)が複数期あれば TrendCard（大きな数字＋棒グラフ）に集約
 *  - 残りはコンパクトなステータスカードのグリッドで
 *  既存 fact_cards の並べ替えのみ（値の加工・生成は一切しない）。
 */
function planCards(cards: FactCard[]): { series: FactCard[] | null; rest: FactCard[] } {
  const valid = cards.filter((c) => c.source?.doc);
  if (valid.length === 0) return { series: null, rest: [] };
  const key = valid[0].metricKey;
  const series = valid.filter((c) => c.metricKey === key);
  const periods = new Set(series.map((c) => `${c.period}:${c.basis}`));
  if (series.length >= 2 && periods.size >= 2) {
    return { series, rest: valid.filter((c) => c.metricKey !== key) };
  }
  return { series: null, rest: valid };
}

/** IR Agent の回答（数値カード＋散文＋出典＋scope分岐＋次の質問サジェスト） */
export const AgentAnswer: React.FC<{
  response: AgentResponse;
  irContactStatus?: 'sending' | 'sent' | 'error';
  onContactIR?: () => void;
  onSuggestion?: (q: string) => void;
}> = ({ response, irContactStatus, onContactIR, onSuggestion }) => {
  const { answer_prose, fact_cards, citations, scope_status, scope_reason, suggestions } = response;
  const { series, rest } = planCards(fact_cards ?? []);

  return (
    <div className="flex flex-col gap-3">
      {/* 数値エリア: トレンドカード（自動集約）＋残りのステータスカード */}
      {series && (
        <div className="animate-fade-slide-in">
          <TrendCard series={series} />
        </div>
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {rest.map((f, i) => (
            <div
              key={`${f.metricKey}-${f.period}-${i}`}
              className="animate-fade-slide-in"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <FactCardView fact={f} />
            </div>
          ))}
        </div>
      )}

      {/* 散文（エディトリアル・白カード） */}
      {answer_prose && (
        <div className="animate-fade-slide-in rounded-3xl bg-paper p-5 shadow-[0_10px_30px_rgba(38,35,29,0.09)]">
          <Markdown>{answer_prose}</Markdown>
        </div>
      )}

      {/* 参考資料 */}
      {citations && citations.length > 0 && (
        <div className="animate-fade-slide-in flex flex-wrap items-center gap-1.5" style={{ animationDelay: '220ms' }}>
          <span className="font-round text-[10.5px] font-black text-mute">参考資料</span>
          {citations.map((c, i) => (<CitationLink key={i} citation={c} />))}
        </div>
      )}

      <ScopeNotice
        status={scope_status}
        reason={scope_reason}
        contactStatus={irContactStatus}
        onContactIR={onContactIR}
      />

      {/* 次の質問サジェスト */}
      {onSuggestion && suggestions && suggestions.length > 0 && (
        <div className="animate-fade-slide-in mt-0.5 flex flex-col gap-2" style={{ animationDelay: '340ms' }}>
          <p className="font-round text-[10.5px] font-black text-mute">つぎはこれ、聞いてみる？</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                style={{ animationDelay: `${420 + i * 60}ms` }}
                onClick={() => onSuggestion(s)}
                className="animate-fade-slide-in rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-2 text-xs font-bold text-ink transition-all duration-200 hover:-translate-y-px hover:bg-ink hover:text-cream active:translate-y-0"
              >
                {s} →
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
