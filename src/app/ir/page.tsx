'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getActiveCompanies, companyShortName } from '@/config/companies';

// /api/ir/metrics の戻り値（#46 1-2b）
interface Metrics {
  company: string;
  days: number;
  totals: { answered: number; refused: number; escalated: number; ir_requests: number; total: number; answer_rate: number };
  ir_requests_questions: { question: string; at: string }[];
  top_questions: { question: string; count: number }[];
}

const DAYS_OPTIONS = [7, 30, 90];

/** IR向けアウトカム・ダッシュボード（#46 1-2c/1-2d）。
 *  認証必須（未ログインは /ir/login へ）。admin は全社、IR担当は自社のみ。 */
export default function IrDashboardPage() {
  const router = useRouter();
  const companies = getActiveCompanies().filter((c) => c.ticker);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [claimCompany, setClaimCompany] = useState<string | undefined>(undefined);

  const [ticker, setTicker] = useState<string>('');
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<{ id: string; question?: string; answer?: string }[]>([]);

  // 認証状態 → 未ログインは login へ。claims で admin/担当社を判定。
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace('/ir/login/');
        return;
      }
      const res = await u.getIdTokenResult();
      const admin = res.claims.admin === true;
      const company = typeof res.claims.company === 'string' ? res.claims.company : undefined;
      setIsAdmin(admin);
      setClaimCompany(company);
      setTicker(admin ? (companies[0]?.ticker ?? '') : (company ?? ''));
      setUser(u);
      setAuthReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!user || !ticker) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/ir/metrics/?company=${encodeURIComponent(ticker)}&days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      else setData(d);
    } catch {
      setError('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [user, ticker, days]);

  // 登録済みFAQ一覧の取得。
  const loadFaqs = useCallback(async () => {
    if (!user || !ticker) return;
    const token = await user.getIdToken();
    const res = await fetch(`/api/ir/faq/?company=${encodeURIComponent(ticker)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (!d.error) setFaqs(d.faqs ?? []);
  }, [user, ticker]);

  useEffect(() => {
    if (authReady && user) {
      load();
      loadFaqs();
    }
  }, [authReady, user, ticker, days, load, loadFaqs]);

  // 未回答にIRが回答／FAQ修正 → 層2に upsert（同一質問は上書き）。
  const submitFaq = useCallback(
    async (question: string, answer: string): Promise<boolean> => {
      if (!user) return false;
      const token = await user.getIdToken();
      const res = await fetch('/api/ir/faq/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, answer, company: ticker }),
      });
      if (res.ok) loadFaqs();
      return res.ok;
    },
    [user, ticker, loadFaqs],
  );

  // FAQ削除。
  const deleteFaq = useCallback(
    async (id: string): Promise<boolean> => {
      if (!user) return false;
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/ir/faq/?id=${encodeURIComponent(id)}&company=${encodeURIComponent(ticker)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) loadFaqs();
      return res.ok;
    },
    [user, ticker, loadFaqs],
  );

  if (!authReady) {
    return <div className="mx-auto max-w-4xl px-5 py-8 text-sm text-zinc-500">認証確認中…</div>;
  }

  const t = data?.totals;
  const maxTop = Math.max(1, ...(data?.top_questions ?? []).map((q) => q.count));
  const lockedName = companyShortName(companies.find((c) => c.ticker === claimCompany)?.name ?? '') || claimCompany;

  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-5 py-8 text-zinc-200">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">IR ダッシュボード</h1>
          <p className="text-sm text-zinc-500">
            投資家の質問トレンドと、未回答（IR要対応）の可視化
            {!isAdmin && lockedName ? `（${lockedName}）` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
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
          )}
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
          <button
            onClick={() => signOut(auth)}
            className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          >
            ログアウト
          </button>
        </div>
      </div>

      {loading && <p className="mt-8 text-sm text-zinc-500">読み込み中…</p>}
      {error && <p className="mt-8 text-sm text-rose-400">エラー: {error}</p>}

      {data && t && !loading && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="総質問数" value={String(t.total)} />
            <Kpi label="回答率" value={`${t.answer_rate}%`} accent="emerald" />
            <Kpi label="IR要対応（問い合わせ）" value={String(t.ir_requests)} accent="amber" />
            <Kpi label="拒否（助言/予測等）" value={String(t.refused)} />
          </div>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="text-sm font-medium text-zinc-300">
              IR要対応（問い合わせ）
              <span className="ml-2 text-xs text-zinc-500">投資家が「IR窓口へ問い合わせる」を押して依頼した質問</span>
            </h2>
            {data.ir_requests_questions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">この期間の問い合わせはありません。</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-800/70">
                {data.ir_requests_questions.map((q, i) => (
                  <EscalationRow key={i} question={q.question} at={q.at} onSubmit={submitFaq} />
                ))}
              </ul>
            )}
          </section>

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

          {/* 登録済みFAQ（修正・削除） */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="text-sm font-medium text-zinc-300">
              登録済みFAQ
              <span className="ml-2 text-xs text-zinc-500">エージェントが自動回答に使うQ&A（{faqs.length}件）</span>
            </h2>
            {faqs.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">まだ登録されたFAQはありません。</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-800/70">
                {faqs.map((f) => (
                  <FaqRow
                    key={f.id}
                    faq={f}
                    onSave={submitFaq}
                    onDelete={() => deleteFaq(f.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-zinc-600">
            ※ 個人を特定する情報は記録していません（匿名・集計のみ）。
          </p>
        </div>
      )}
    </div>
  );
}

/** 登録済みFAQ1件＋修正/削除。修正は同じ質問で upsert（上書き）。 */
function FaqRow({
  faq,
  onSave,
  onDelete,
}: {
  faq: { id: string; question?: string; answer?: string };
  onSave: (q: string, a: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(faq.answer ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!faq.question || !answer.trim()) return;
    setBusy(true);
    const ok = await onSave(faq.question, answer.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };
  const remove = async () => {
    if (!confirm('このFAQを削除しますか？')) return;
    setBusy(true);
    await onDelete();
  };

  return (
    <li className="py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-zinc-200">{faq.question}</div>
          {!editing && <div className="mt-0.5 text-xs text-zinc-500">{faq.answer}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:text-zinc-100"
          >
            {editing ? '閉じる' : '修正'}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-rose-300 transition hover:border-rose-500/40 disabled:opacity-40"
          >
            削除
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-2">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
          />
          <button
            onClick={save}
            disabled={busy || !answer.trim()}
            className="mt-1.5 rounded-lg bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {busy ? '保存中…' : '更新する'}
          </button>
        </div>
      )}
    </li>
  );
}

/** 未回答1件＋回答フォーム。回答するとFAQ登録→次回から自動回答。 */
function EscalationRow({
  question,
  at,
  onSubmit,
}: {
  question: string;
  at: string;
  onSubmit: (q: string, a: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  const save = async () => {
    if (!answer.trim()) return;
    setStatus('saving');
    setStatus((await onSubmit(question, answer.trim())) ? 'done' : 'error');
  };

  if (status === 'done') {
    return (
      <li className="py-2 text-sm">
        <span className="text-zinc-400 line-through">{question}</span>
        <span className="ml-2 text-xs text-emerald-400">✓ FAQ登録済み（次回から自動回答）</span>
      </li>
    );
  }

  return (
    <li className="py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-zinc-200">{question}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-zinc-500">{at}</span>
          <button
            onClick={() => setOpen(!open)}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:text-zinc-100"
          >
            {open ? '閉じる' : '回答する'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            placeholder="開示済みの内容で回答を入力（投資家にそのまま提示されます）"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={save}
              disabled={status === 'saving' || !answer.trim()}
              className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              {status === 'saving' ? '登録中…' : 'FAQに登録'}
            </button>
            {status === 'error' && <span className="text-xs text-rose-400">登録に失敗しました</span>}
          </div>
        </div>
      )}
    </li>
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
