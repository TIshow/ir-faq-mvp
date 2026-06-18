'use client';

import React from 'react';
import { AgentResponse, Citation, FactCard, ScopeStatus } from '@/lib/agent-types';

/** 出典リンク：原本PDFの該当ページへ #page=N でディープリンク */
export const CitationLink: React.FC<{ citation: Citation; compact?: boolean }> = ({ citation, compact }) => {
  const label = citation.page ? `${citation.doc} p.${citation.page}` : citation.doc;
  const href = citation.url ? (citation.page ? `${citation.url}#page=${citation.page}` : citation.url) : undefined;
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

const ScopeNotice: React.FC<{ status: ScopeStatus; onContactIR?: () => void }> = ({ status, onContactIR }) => {
  if (status === 'answered') return null;
  if (status === 'refused') {
    return (
      <div className="mt-2 text-xs text-zinc-500">
        ※ 投資判断の助言や未開示情報にはお答えできません。開示済みの事実についてお尋ねください。
      </div>
    );
  }
  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <p className="mb-2 text-xs text-zinc-400">この質問は開示資料に見当たりませんでした。IR窓口にお取り次ぎできます。</p>
      <button
        onClick={onContactIR}
        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition hover:bg-emerald-400"
      >
        IR窓口へ問い合わせる
      </button>
    </div>
  );
};

/** IR Agent の回答（散文＋数値カード＋出典＋scope分岐） */
export const AgentAnswer: React.FC<{ response: AgentResponse; onContactIR?: () => void }> = ({ response, onContactIR }) => {
  const { answer_prose, fact_cards, citations, scope_status } = response;
  return (
    <div>
      {answer_prose && <div className="whitespace-pre-wrap">{answer_prose}</div>}

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

      <ScopeNotice status={scope_status} onContactIR={onContactIR} />
    </div>
  );
};
