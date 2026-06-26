'use client';

import React from 'react';
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

/** 出典リンク：原本PDFの該当ページへ署名URL経由でディープリンク */
export const CitationLink: React.FC<{ citation: Citation; compact?: boolean }> = ({ citation, compact }) => {
  const label = citation.page ? `${citation.doc} p.${citation.page}` : citation.doc;
  const href = toDocHref(citation);
  const cls = `inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'} text-zinc-400 transition hover:text-emerald-400`;
  const content = <span title={citation.quote ?? undefined}>📄 {label}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>
  ) : (
    <span className={`${compact ? 'text-[11px]' : 'text-xs'} text-zinc-500`}>{content}</span>
  );
};

/** 数値カード（層1由来）。出典の無いカードは描画しない。予想は点線枠＋会社予想バッジ。 */
export const FactCardView: React.FC<{ fact: FactCard }> = ({ fact }) => {
  if (!fact.source || !fact.source.doc) return null;
  const isForecast = fact.basis === 'forecast';
  const up = fact.yoy?.startsWith('+');
  const down = fact.yoy?.startsWith('-') || fact.yoy?.startsWith('△');

  return (
    <div
      className={[
        'min-w-[150px] rounded-xl bg-zinc-950/60 p-3',
        isForecast ? 'border border-dashed border-amber-500/40' : 'border border-zinc-800',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-500">{fact.metric}</span>
        {isForecast && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">会社予想</span>
        )}
      </div>

      <div className="mt-1 font-mono text-xl font-semibold tracking-tight text-zinc-100">{fact.value}</div>

      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-500">{fact.period}</span>
        {fact.yoy && (
          <span className={`font-mono text-[11px] font-semibold ${up ? 'text-emerald-400' : down ? 'text-rose-400' : 'text-zinc-400'}`}>
            {up ? '▲' : down ? '▼' : ''}{fact.yoy} YoY
          </span>
        )}
      </div>

      <div className="mt-0.5 text-[11px] text-zinc-600">
        {fact.consolidated ? '連結' : '単体'}・{isForecast ? '予想' : '実績'}
      </div>

      <div className="mt-2 border-t border-zinc-800/80 pt-2">
        <CitationLink citation={fact.source} compact />
      </div>
    </div>
  );
};

type ContactStatus = 'sending' | 'sent' | 'error' | undefined;

const ScopeNotice: React.FC<{
  status: ScopeStatus;
  contactStatus?: ContactStatus;
  onContactIR?: () => void;
}> = ({ status, contactStatus, onContactIR }) => {
  if (status === 'answered') return null;
  if (status === 'refused') {
    return (
      <div className="mt-2 text-xs text-zinc-500">
        ※ 投資判断の助言や未開示情報にはお答えできません。開示済みの事実についてお尋ねください。
      </div>
    );
  }

  if (contactStatus === 'sent') {
    // 完了: 落ち着いた成功カード（非ブロッキング・文脈内インライン）
    return (
      <div className="mt-3 border-t border-zinc-800 pt-3">
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
          <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-zinc-950">
            ✓
          </span>
          <div className="text-xs leading-relaxed">
            <p className="font-medium text-emerald-300">IR窓口へお取り次ぎしました</p>
            <p className="text-zinc-400">担当者が内容を確認します。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <p className="mb-2 text-xs text-zinc-400">この質問は開示資料に見当たりませんでした。IR窓口にお取り次ぎできます。</p>
      <button
        onClick={onContactIR}
        disabled={contactStatus === 'sending'}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {contactStatus === 'sending' ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-950/30 border-t-zinc-950" />
            送信中…
          </>
        ) : (
          'IR窓口へ問い合わせる'
        )}
      </button>
      {contactStatus === 'error' && (
        <p className="mt-1.5 text-xs text-rose-400">送信に失敗しました。もう一度お試しください。</p>
      )}
    </div>
  );
};

/** IR Agent の回答（散文＋数値カード＋出典＋scope分岐＋次の質問サジェスト） */
export const AgentAnswer: React.FC<{
  response: AgentResponse;
  irContactStatus?: 'sending' | 'sent' | 'error';
  onContactIR?: () => void;
  onSuggestion?: (q: string) => void;
}> = ({ response, irContactStatus, onContactIR, onSuggestion }) => {
  const { answer_prose, fact_cards, citations, scope_status, suggestions } = response;
  return (
    <div>
      {answer_prose && <Markdown>{answer_prose}</Markdown>}

      {fact_cards && fact_cards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {fact_cards.map((f, i) => (
            <FactCardView key={`${f.metricKey}-${f.period}-${i}`} fact={f} />
          ))}
        </div>
      )}

      {citations && citations.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">参考資料</p>
          <div className="flex flex-col gap-1">
            {citations.map((c, i) => (<CitationLink key={i} citation={c} />))}
          </div>
        </div>
      )}

      <ScopeNotice status={scope_status} contactStatus={irContactStatus} onContactIR={onContactIR} />

      {onSuggestion && suggestions && suggestions.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">次に聞いてみる</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggestion(s)}
                className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:bg-zinc-800/80 hover:text-zinc-100"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
