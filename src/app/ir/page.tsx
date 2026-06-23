'use client';

import { useEffect, useState } from 'react';
import { getActiveCompanies, companyShortName } from '@/config/companies';

// /api/ir/metrics の戻り値（#46 1-2b）
interface Metrics {
  company: string;
  days: number;
  totals: { answered: number; refused: number; escalated: number; total: number; answer_rate: number };
  escalated_questions: { question: string; at: string }[];
  top_questions: { question: string; count: number }[];
}

const DAYS_OPTIONS = [7, 30, 90];

/** IR向けアウトカム・ダッシュボード（#46 1-2c）。投資家チャットとは別画面。
 *  ※認証は 1-2d で追加予定（現状は未認証）。 */
export default function IrDashboardPage() {
  const companies = getActiveCompanies().filter((c) => c.ticker);
  const [ticker, setTicker] = useState<string>(
    companies.find((c) => c.id === 'harux')?.ticker ?? companies[0]?.ticker ?? '',
  );
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    fetch(`/api/ir/metrics/?company=${encodeURIComponent(ticker)}&days=${days}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError('取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [ticker, days]);

  const t = data?.totals;
  const maxTop = Math.max(1, ...(data?.top_questions ?? []).map((q) => q.count));

  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-5 py-8 text-zinc-200">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">IR ダッシュボード</h1>
          <p className="text-sm text-zinc-500">投資家からの質問トレンドと、未回答（IR要対応）の可視化</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.ticker}>
                {companyShortName(c.name)}（{c.ticker}）
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
          >
            {DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                直近{d}日
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="mt-8 text-sm text-zinc-500">読み込み中…</p>}
      {error && <p className="mt-8 text-sm text-rose-400">エラー: {error}</p>}

      {data && t && !loading && (
        <div className="mt-6 space-y-6">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="総質問数" value={String(t.total)} />
            <Kpi label="回答率" value={`${t.answer_rate}%`} accent="emerald" />
            <Kpi label="エスカレーション" value={String(t.escalated)} accent="amber" />
            <Kpi label="拒否（助言/予測等）" value={String(t.refused)} />
          </div>

          {/* エスカレーション一覧（痛み②の核） */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="text-sm font-medium text-zinc-300">
              未回答（IR要対応）<span className="ml-2 text-xs text-zinc-500">資料で答えられず IR窓口へ回った質問</span>
            </h2>
            {data.escalated_questions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">この期間の未回答はありません。</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-800/70">
                {data.escalated_questions.map((q, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="text-zinc-200">{q.question}</span>
                    <span className="shrink-0 font-mono text-xs text-zinc-500">{q.at}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 頻出質問 */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="text-sm font-medium text-zinc-300">頻出質問トップ</h2>
            {data.top_questions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">データがありません。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.top_questions.map((q, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-zinc-200">{q.question}</span>
                      <span className="shrink-0 font-mono text-xs text-zinc-500">{q.count}件</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500/70"
                        style={{ width: `${(q.count / maxTop) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-zinc-600">
            ※ 個人を特定する情報は記録していません（匿名・集計のみ）。認証は今後追加予定。
          </p>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'amber' }) {
  const color =
    accent === 'emerald' ? 'text-emerald-400' : accent === 'amber' ? 'text-amber-400' : 'text-zinc-100';
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
