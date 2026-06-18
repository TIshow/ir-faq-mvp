'use client';

import React from 'react';
import { AgentResponse, Citation, FactCard, ScopeStatus } from '@/lib/agent-types';

/**
 * 出典リンク：原本PDFの該当ページへ #page=N でディープリンク。
 * URLが無い出典はリンクにせずラベルのみ表示する。
 */
export const CitationLink: React.FC<{ citation: Citation; compact?: boolean }> = ({ citation, compact }) => {
  const label = citation.page ? `${citation.doc} p.${citation.page}` : citation.doc;
  const href = citation.url
    ? citation.page
      ? `${citation.url}#page=${citation.page}`
      : citation.url
    : undefined;

  const className = compact
    ? 'inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline'
    : 'inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline';

  const content = (
    <span title={citation.quote ?? undefined}>
      📄 {label}
    </span>
  );

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <span className={compact ? 'text-[11px] text-gray-500' : 'text-xs text-gray-500'}>{content}</span>
  );
};

/**
 * 数値カード（層1由来）。
 * 出典の無いカードは描画しない（信頼の最低保証）。
 * 予想は点線枠＋「会社予想」バッジで実績と視覚区別する。
 */
export const FactCardView: React.FC<{ fact: FactCard }> = ({ fact }) => {
  // 出典が無いカードは描画しない
  if (!fact.source || !fact.source.doc) return null;

  const isForecast = fact.basis === 'forecast';
  const yoyPositive = fact.yoy?.startsWith('+');
  const yoyNegative = fact.yoy?.startsWith('-') || fact.yoy?.startsWith('△');

  return (
    <div
      className={[
        'min-w-[150px] rounded-lg p-3 bg-white dark:bg-gray-900',
        isForecast
          ? 'border border-dashed border-amber-400 dark:border-amber-500'
          : 'border border-gray-200 dark:border-gray-700',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{fact.metric}</span>
        {isForecast && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            会社予想
          </span>
        )}
      </div>

      <div className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{fact.value}</div>

      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{fact.period}</span>
        {fact.yoy && (
          <span
            className={[
              'text-[11px] font-medium',
              yoyPositive ? 'text-green-600 dark:text-green-400' : '',
              yoyNegative ? 'text-red-600 dark:text-red-400' : '',
              !yoyPositive && !yoyNegative ? 'text-gray-500' : '',
            ].join(' ')}
          >
            {yoyPositive ? '▲' : yoyNegative ? '▼' : ''} {fact.yoy} YoY
          </span>
        )}
      </div>

      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {fact.consolidated ? '連結' : '単体'}・{isForecast ? '予想' : '実績'}
      </div>

      <div className="mt-2">
        <CitationLink citation={fact.source} compact />
      </div>
    </div>
  );
};

const ScopeNotice: React.FC<{ status: ScopeStatus; onContactIR?: () => void }> = ({ status, onContactIR }) => {
  if (status === 'answered') return null;

  if (status === 'refused') {
    return (
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        ※ 投資判断の助言や未開示情報にはお答えできません。開示済みの事実についてお尋ねください。
      </div>
    );
  }

  // escalated
  return (
    <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
        この質問は開示資料に見当たりませんでした。IR窓口にお取り次ぎできます。
      </p>
      <button
        onClick={onContactIR}
        className="px-3 py-1 text-xs text-white bg-blue-600 rounded-md hover:bg-blue-700"
      >
        IR窓口へ問い合わせる
      </button>
    </div>
  );
};

/**
 * IR Agent の回答を描画する単一コンポーネント。
 *  - 数値は fact_cards に集約（散文は薄め）
 *  - 出典は原本ページへディープリンク
 *  - scope_status で表示を分岐
 */
export const AgentAnswer: React.FC<{ response: AgentResponse; onContactIR?: () => void }> = ({
  response,
  onContactIR,
}) => {
  const { answer_prose, fact_cards, citations, scope_status } = response;

  return (
    <div>
      {answer_prose && <div className="whitespace-pre-wrap">{answer_prose}</div>}

      {fact_cards && fact_cards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {fact_cards.map((fact, i) => (
            <FactCardView key={`${fact.metricKey}-${fact.period}-${i}`} fact={fact} />
          ))}
        </div>
      )}

      {citations && citations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
          <p className="text-xs font-medium mb-2 text-gray-600 dark:text-gray-400">参考資料:</p>
          <div className="flex flex-col gap-1">
            {citations.map((c, i) => (
              <CitationLink key={i} citation={c} />
            ))}
          </div>
        </div>
      )}

      <ScopeNotice status={scope_status} onContactIR={onContactIR} />
    </div>
  );
};
