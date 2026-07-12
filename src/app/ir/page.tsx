'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getActiveCompanies, companyShortName } from '@/config/companies';
import { NaruhodoMark } from '@/components/BrandLogo';

// /api/ir/metrics の戻り値（#46 1-2b）
interface Metrics {
  company: string;
  days: number;
  totals: {
    answered: number;
    refused: number;
    escalated: number;
    ir_requests: number;
    total: number;
    prev_total: number;
    answer_rate: number;
  };
  ir_requests_questions: { question: string; at: string; count: number }[];
  top_topics: { topic: string; count: number }[];
  weekly: { week: string; count: number }[];
}

const DAYS_OPTIONS = [7, 30, 90];

// 話題タクソノミー（agent/analytics.py TOPICS）→ アイコン。未知の話題は 💬。
const TOPIC_ICONS: Record<string, string> = {
  '業績・決算（全社）': '📊',
  'セグメント・事業別': '🧩',
  '会社予想・ガイダンス': '🧭',
  '配当・株主還元': '💰',
  株主優待: '🎁',
  '財務体質（資産・負債・CF）': '🏦',
  '資本効率（ROE・ROIC）': '🎯',
  '成長戦略・中計': '🚀',
  '事業内容・ビジネスモデル': '🏢',
  '市場環境・競合': '🌍',
  'ESG・サステナビリティ': '🌱',
  'ガバナンス・経営体制': '⚖️',
  '用語・使い方': '📖',
  その他: '💬',
  '対象外（助言・予測・未開示）': '🚫',
};
const topicIcon = (t: string) => TOPIC_ICONS[t] ?? '💬';
const topicBarColor = (t: string) =>
  t.startsWith('対象外') || t === '不適切' ? '#FF8A66' : t === 'その他' ? '#B7B0A2' : '#22C06A';

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

  // 未回答にIRが回答／FAQ修正・新規追加 → 層2に upsert（同一質問は上書き）。
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

  // IR要対応を「解決済み」にする（質問単位で worklist から外す。同一質問の重複もまとめて消える）。
  const resolveRequest = useCallback(
    async (question: string): Promise<boolean> => {
      if (!user) return false;
      const token = await user.getIdToken();
      const res = await fetch('/api/ir/resolve/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, company: ticker }),
      });
      if (res.ok) load();
      return res.ok;
    },
    [user, ticker, load],
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
    return (
      <div className="mx-auto max-w-5xl px-5 py-10 text-sm font-medium text-mute">認証確認中…</div>
    );
  }

  const t = data?.totals;
  const delta = t ? t.total - t.prev_total : 0;
  const maxTop = Math.max(1, ...(data?.top_topics ?? []).map((q) => q.count));
  const maxWeek = Math.max(1, ...(data?.weekly ?? []).map((w) => w.count));
  const lockedName =
    companyShortName(companies.find((c) => c.ticker === claimCompany)?.name ?? '') || claimCompany;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1060px] px-5 py-8 text-ink">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <NaruhodoMark height={38} />
          <div>
            <h1 className="font-round text-[19px] font-black leading-tight text-ink">
              IRダッシュボード
            </h1>
            <p className="mt-0.5 text-[11.5px] font-medium text-mute">
              投資家の質問トレンドと、未回答（IR要対応）の可視化
              {!isAdmin && lockedName ? `（${lockedName}）` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="rounded-full bg-paper px-4 py-2 text-xs font-bold text-ink shadow-e1 focus:outline-none"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.ticker}>
                  {companyShortName(c.name)}（{c.ticker}）
                </option>
              ))}
            </select>
          )}
          {/* 期間セグメント */}
          <div className="flex items-center rounded-full bg-paper p-1 shadow-e1">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition ${
                  days === d ? 'bg-ink text-cream' : 'text-mute hover:text-ink'
                }`}
              >
                {d}日
              </button>
            ))}
          </div>
          <button
            onClick={() => signOut(auth)}
            className="rounded-full border-[1.5px] border-line bg-transparent px-4 py-2 text-[11.5px] font-bold text-mute transition hover:border-ink hover:text-ink"
          >
            ログアウト
          </button>
        </div>
      </div>

      {loading && <p className="mt-8 text-sm font-medium text-mute">読み込み中…</p>}
      {error && <p className="mt-8 text-sm font-bold text-coral-deep">エラー: {error}</p>}

      {data && t && !loading && (
        <div className="mt-6 space-y-4">
          {/* KPI行 */}
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {/* 総質問数（インクカード＋前期間比） */}
            <div className="rounded-3xl bg-ink p-5 text-cream">
              <div className="text-[11px] font-bold text-mute">総質問数</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-num text-[38px] font-extrabold leading-none">{t.total}</span>
                {delta !== 0 && (
                  <span
                    className={`text-[11px] font-bold ${delta > 0 ? 'text-pop-soft' : 'text-coral'}`}
                  >
                    {delta > 0 ? `+${delta} ↑` : `${delta} ↓`}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[10px] text-mute">前の{data.days}日比</div>
            </div>
            {/* 自動回答率 */}
            <div className="rounded-3xl bg-paper p-5 shadow-e2">
              <div className="text-[11px] font-bold text-mute">自動回答率</div>
              <div className="mt-1.5 font-num text-[38px] font-extrabold leading-none text-pop">
                {t.answer_rate}
                <span className="text-[19px]">%</span>
              </div>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-cream">
                <div
                  className="h-full rounded-full bg-pop"
                  style={{ width: `${Math.min(100, t.answer_rate)}%` }}
                />
              </div>
            </div>
            {/* IR要対応 */}
            <div className="relative rounded-3xl bg-paper p-5 shadow-e2">
              {t.ir_requests > 0 && (
                <span className="font-round absolute -top-2 right-3.5 -rotate-[4deg] rounded-full bg-sun px-2.5 py-1 text-[10px] font-black text-ink shadow-e1">
                  要チェック！
                </span>
              )}
              <div className="text-[11px] font-bold text-mute">IR要対応（問い合わせ）</div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-num text-[38px] font-extrabold leading-none text-sun-deep">
                  {t.ir_requests}
                </span>
                <span className="text-[11px] font-bold text-mute">件</span>
              </div>
              <div className="mt-1.5 text-[10px] text-mute">投資家がIR窓口へ依頼した質問</div>
            </div>
            {/* 回答対象外 */}
            <div className="rounded-3xl bg-paper p-5 shadow-e2">
              <div className="text-[11px] font-bold text-mute">回答対象外</div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-num text-[38px] font-extrabold leading-none text-coral-deep">
                  {t.refused}
                </span>
                <span className="text-[11px] font-bold text-mute">件</span>
              </div>
              <div className="mt-1.5 text-[10px] text-mute">助言・予測などお答えできない質問</div>
            </div>
          </div>

          {/* メイン2カラム */}
          <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]">
            {/* 左: IR要対応 ＋ FAQ */}
            <div className="flex flex-col gap-4">
              <section className="rounded-3xl bg-paper p-6 shadow-e2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-round text-[15px] font-black text-ink">IR要対応の質問</h2>
                    <span className="font-num rounded-full bg-sun px-2.5 py-0.5 text-[11px] font-bold text-ink">
                      {data.ir_requests_questions.length}
                    </span>
                  </div>
                  <span className="text-[10.5px] font-medium text-mute">
                    「IR窓口へ問い合わせる」から届いた質問
                  </span>
                </div>
                {data.ir_requests_questions.length === 0 ? (
                  <p className="mt-4 text-sm font-medium text-mute">
                    この期間の問い合わせはありません。
                  </p>
                ) : (
                  <ul>
                    {data.ir_requests_questions.map((q, i) => (
                      <EscalationRow
                        key={i}
                        question={q.question}
                        at={q.at}
                        count={q.count}
                        onSubmit={submitFaq}
                        onResolve={resolveRequest}
                      />
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[10.5px] text-mute">
                  💡 回答するとFAQに登録され、次から同じ質問にはエージェントが自動で答えます。
                </p>
              </section>

              {/* 登録済みFAQ（新規追加・修正・削除） */}
              <section className="rounded-3xl bg-paper p-6 shadow-e2">
                <FaqHeader count={faqs.length} onSave={submitFaq} />
                {faqs.length === 0 ? (
                  <p className="mt-4 text-sm font-medium text-mute">
                    まだ登録されたFAQはありません。
                  </p>
                ) : (
                  <ul>
                    {faqs.map((f) => (
                      <FaqRow key={f.id} faq={f} onSave={submitFaq} onDelete={() => deleteFaq(f.id)} />
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* 右: 話題トレンド ＋ 週次 */}
            <div className="flex flex-col gap-4">
              <section className="rounded-3xl bg-paper p-6 shadow-e2">
                <h2 className="font-round text-[15px] font-black text-ink">話題トレンド</h2>
                <p className="mt-1 text-[10.5px] leading-relaxed text-mute">
                  投資家の関心を話題ごとに集計。プライバシー保護のため質問の原文は表示しません。
                </p>
                {data.top_topics.length === 0 ? (
                  <p className="mt-4 text-sm font-medium text-mute">データがありません。</p>
                ) : (
                  <ul className="mt-4 space-y-3.5">
                    {data.top_topics.map((q, i) => (
                      <li key={i}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <span className="flex items-center gap-1.5 truncate text-[12.5px] font-bold text-ink">
                            <span aria-hidden>{topicIcon(q.topic)}</span>
                            {q.topic}
                          </span>
                          <span
                            className="font-num shrink-0 text-xs font-bold"
                            style={{ color: topicBarColor(q.topic) }}
                          >
                            {q.count}
                            <span className="font-sans text-[10px] font-semibold text-mute"> 件</span>
                          </span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-cream">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(q.count / maxTop) * 100}%`,
                              background: topicBarColor(q.topic),
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-3xl bg-paper p-6 shadow-e2">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-round text-[15px] font-black text-ink">週ごとの質問数</h2>
                  <span className="text-[10.5px] font-medium text-mute">直近4週</span>
                </div>
                <div className="mt-4 flex items-end gap-3.5 px-1" style={{ height: 110 }}>
                  {(data.weekly ?? []).map((w, i, arr) => {
                    const latest = i === arr.length - 1;
                    const h = Math.max(8, Math.round((w.count / maxWeek) * 78));
                    return (
                      <div key={w.week} className="flex h-full flex-1 flex-col justify-end gap-1.5">
                        <div
                          className={`font-num text-center text-[11px] ${
                            latest ? 'font-bold text-pop' : 'font-semibold text-mute'
                          }`}
                        >
                          {w.count}
                        </div>
                        <div
                          className={`mx-auto w-full max-w-[64px] rounded-t-full ${
                            latest ? 'bg-pop' : 'bg-line'
                          }`}
                          style={{ height: h }}
                        />
                        <div className="text-center text-[10px] font-bold text-mute">{w.week}週</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>

          <p className="pt-2 text-center text-[10.5px] text-mute">
            ※ 個人を特定する情報は記録していません（匿名・集計のみ）。
          </p>
        </div>
      )}
    </div>
  );
}

/** FAQカードのヘッダ（件数バッジ＋「＋新規追加」フォーム） */
function FaqHeader({
  count,
  onSave,
}: {
  count: number;
  onSave: (q: string, a: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!question.trim() || !answer.trim()) return;
    setBusy(true);
    const ok = await onSave(question.trim(), answer.trim());
    setBusy(false);
    if (ok) {
      setQuestion('');
      setAnswer('');
      setOpen(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="font-round text-[15px] font-black text-ink">登録済みFAQ</h2>
          <span className="font-num rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-bold text-cream">
            {count}
          </span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-1.5 text-[11.5px] font-bold text-ink transition hover:bg-ink hover:text-cream"
        >
          {open ? '閉じる' : '＋ 新規追加'}
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-2xl bg-cream p-3.5">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="質問（例: 配当方針を教えてください）"
            className="w-full rounded-xl bg-paper px-3.5 py-2.5 text-sm font-medium text-ink placeholder:text-mute focus:outline-none"
          />
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            placeholder="回答（開示済みの内容で。投資家にそのまま提示されます）"
            className="mt-2 w-full rounded-xl bg-paper px-3.5 py-2.5 text-sm font-medium text-ink placeholder:text-mute focus:outline-none"
          />
          <button
            onClick={save}
            disabled={busy || !question.trim() || !answer.trim()}
            className="mt-2 rounded-full bg-pop px-4 py-2 text-xs font-bold text-white transition hover:bg-pop-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-mute"
          >
            {busy ? '登録中…' : 'FAQに登録'}
          </button>
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
    <li className="border-b-[1.5px] border-dashed border-line py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-relaxed text-ink">{faq.question}</div>
          {!editing && (
            <div className="mt-2 flex items-start gap-2 rounded-xl bg-cream px-3.5 py-2.5">
              <span className="font-round mt-0.5 shrink-0 text-[10px] font-black text-pop">A.</span>
              <span className="text-xs leading-relaxed text-ink-soft">{faq.answer}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-bold text-ink transition hover:border-ink"
          >
            {editing ? '閉じる' : '修正'}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-full border-[1.5px] border-coral/40 px-3 py-1.5 text-[11.5px] font-bold text-coral-deep transition hover:border-coral disabled:opacity-40"
          >
            削除
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-2.5">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            className="w-full rounded-xl bg-cream px-3.5 py-2.5 text-sm font-medium text-ink focus:outline-none"
          />
          <button
            onClick={save}
            disabled={busy || !answer.trim()}
            className="mt-2 rounded-full bg-pop px-4 py-1.5 text-xs font-bold text-white transition hover:bg-pop-deep disabled:bg-line disabled:text-mute"
          >
            {busy ? '保存中…' : '更新する'}
          </button>
        </div>
      )}
    </li>
  );
}

/** 未回答1件＋回答フォーム。回答するとFAQ登録→次回から自動回答。削除で worklist から外す。 */
function EscalationRow({
  question,
  at,
  count,
  onSubmit,
  onResolve,
}: {
  question: string;
  at: string;
  count: number;
  onSubmit: (q: string, a: string) => Promise<boolean>;
  onResolve: (q: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [resolving, setResolving] = useState(false);

  const save = async () => {
    if (!answer.trim()) return;
    setStatus('saving');
    setStatus((await onSubmit(question, answer.trim())) ? 'done' : 'error');
  };

  const resolve = async () => {
    if (!confirm('この問い合わせを解決済みにして一覧から削除しますか？（同じ質問の重複もまとめて消えます）'))
      return;
    setResolving(true);
    const ok = await onResolve(question);
    if (!ok) setResolving(false); // 失敗時のみ戻す（成功時は一覧が再取得され消える）
  };

  if (status === 'done') {
    return (
      <li className="flex flex-wrap items-center gap-2 border-b-[1.5px] border-dashed border-line py-4 text-sm last:border-b-0">
        <span className="font-medium text-mute line-through">{question}</span>
        <span className="text-xs font-bold text-pop-deep">✓ FAQ登録済み（次回から自動回答）</span>
        <button
          onClick={resolve}
          disabled={resolving}
          className="rounded-full border-[1.5px] border-coral/40 px-3 py-1 text-[11.5px] font-bold text-coral-deep transition hover:border-coral disabled:opacity-40"
        >
          一覧から削除
        </button>
      </li>
    );
  }

  return (
    <li className="border-b-[1.5px] border-dashed border-line py-4 last:border-b-0">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cream text-[15px]"
        >
          📮
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-relaxed text-ink">
            {question}
            {count > 1 && (
              <span className="font-num ml-2 rounded-full bg-sun/25 px-1.5 py-0.5 align-middle text-[11px] font-bold text-sun-deep">
                ×{count}
              </span>
            )}
          </div>
          <div className="font-num mt-0.5 text-[10.5px] font-semibold text-mute">{at}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setOpen(!open)}
            className="rounded-full bg-pop px-4 py-2 text-[11.5px] font-bold text-white transition hover:bg-pop-deep"
          >
            {open ? '閉じる' : '回答する'}
          </button>
          <button
            onClick={resolve}
            disabled={resolving}
            className="rounded-full border-[1.5px] border-coral/40 px-3.5 py-2 text-[11.5px] font-bold text-coral-deep transition hover:border-coral disabled:opacity-40"
          >
            {resolving ? '…' : '削除'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2.5">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            placeholder="開示済みの内容で回答を入力（投資家にそのまま提示されます）"
            className="w-full rounded-xl bg-cream px-3.5 py-2.5 text-sm font-medium text-ink placeholder:text-mute focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={save}
              disabled={status === 'saving' || !answer.trim()}
              className="rounded-full bg-pop px-4 py-2 text-xs font-bold text-white transition hover:bg-pop-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-mute"
            >
              {status === 'saving' ? '登録中…' : 'FAQに登録'}
            </button>
            {status === 'error' && (
              <span className="text-xs font-bold text-coral-deep">登録に失敗しました</span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
