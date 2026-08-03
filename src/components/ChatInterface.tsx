'use client';

import { useState, useRef, useEffect } from 'react';
import { companyShortName, type Company } from '@/config/companies';
import { AgentResponse } from '@/lib/agent-types';
import { AgentAnswer } from '@/components/FactCard';
import { Markdown } from '@/components/Markdown';
import { NaruhodoMark } from '@/components/BrandLogo';
import { QaPanel } from '@/components/QaPanel';
import { PILL_INK, PILL_QUIET } from '@/components/ui';
import type { CompanyHeadline, PublicQa } from '@/lib/public-facts';

// ガイド付き入口（企業はピッカーで選択するため企業名は含めない＝スコープ安全）
const GUIDED_ENTRIES = [
  '最新の決算サマリ',
  '営業利益は前年同期比でどうでしたか？',
  'セグメント別の業績',
  '配当はどうなっていますか？',
  '中期経営計画の進捗',
];

// 読者レベル（回答の"翻訳度"だけが変わる。専門性・正確性は同じ）。
// カジュアル=投資1年目でも読めるやさしい言い換え / スタンダード=一般的な個人投資家向け。
type Audience = 'casual' | 'standard';
const AUDIENCES: { key: Audience; label: string }[] = [
  { key: 'casual', label: 'カジュアル' },
  { key: 'standard', label: 'スタンダード' },
];
// 旧3段階の保存値からの移行（初心者→カジュアル、それ以外→スタンダード）
const LEGACY_AUDIENCE: Record<string, Audience> = {
  beginner: 'casual',
  intermediate: 'standard',
  advanced: 'standard',
};

/**
 * 吹き出しガーデンの「よく聞かれる順」階層（claude.ai/design「Naruhodo IR Home」）。
 * 上位ほど大きく・濃い。順位は index で決まる＝決定論。色の並びはデザイン準拠
 * （インク → グリーン → 白 → イエロー → 白 → コーラル → 破線）。
 *
 * デザインは各カードを回転させているが、**実装では回さない**（可読性を優先）。
 * 代わりに配置で散らす: カードは文字量ぶんの幅で折り返し配置し、順位ごとに
 * 上限幅（width）と上マージン（offset）を変えて縦位置に段差をつける。
 * 段差は sm 以上だけ（スマホは1列に積むので、段差があると崩れて見える）。
 *
 * **件数（「N人が質問」）は出さない**: 会話の本文をどこにも保存していないため
 * 質問単位の集計は存在せず、数字を書けば捏造になる（プライバシー設計 CLAUDE.md）。
 * 現在の並びは `companies.ts` の guidedQuestions（IR/我々が「よく聞かれる」と判断した順）。
 * 実績データ（BigQuery interactions.topic の話題別件数）での並べ替えは #113 段階C。
 */
const BUBBLE_STYLES = [
  { box: 'bg-ink px-6 py-5 shadow-e3', text: 'text-cream text-[19px] sm:text-[22px]', radius: 'rounded-[30px] rounded-bl-lg', width: 'sm:max-w-[21rem]', offset: '' },
  { box: 'bg-pop px-5 py-4 shadow-e3', text: 'text-cream text-[15.5px] sm:text-[18px]', radius: 'rounded-[28px] rounded-br-lg', width: 'sm:max-w-[17rem]', offset: 'sm:mt-5' },
  { box: 'bg-paper px-5 py-4 shadow-e2', text: 'text-ink text-[14px] sm:text-[16px]', radius: 'rounded-[26px] rounded-bl-lg', width: 'sm:max-w-[14rem]', offset: '' },
  { box: 'bg-sun px-5 py-4 shadow-e2', text: 'text-ink text-[14px] sm:text-[16.5px]', radius: 'rounded-[26px] rounded-tr-lg', width: 'sm:max-w-[15rem]', offset: 'sm:mt-4' },
  { box: 'bg-paper px-5 py-4 shadow-e2', text: 'text-ink text-[13.5px] sm:text-[15px]', radius: 'rounded-[26px] rounded-br-lg', width: 'sm:max-w-[18rem]', offset: 'sm:mt-2' },
  { box: 'bg-coral/20 px-4 py-3.5 shadow-e2', text: 'text-ink text-[13px] sm:text-[14.5px]', radius: 'rounded-[24px] rounded-bl-lg', width: 'sm:max-w-[13.5rem]', offset: '' },
  { box: 'bg-paper border-[1.5px] border-dashed border-line px-4 py-3', text: 'text-ink text-[13px] sm:text-[14px]', radius: 'rounded-[22px] rounded-bl-lg', width: 'sm:max-w-[13rem]', offset: 'sm:mt-6' },
  { box: 'bg-paper border-[1.5px] border-dashed border-line px-4 py-3', text: 'text-ink text-[13px] sm:text-[14px]', radius: 'rounded-[22px] rounded-br-lg', width: 'sm:max-w-[14rem]', offset: 'sm:mt-4' },
  { box: 'bg-paper border-[1.5px] border-dashed border-line px-4 py-3', text: 'text-ink text-[13px] sm:text-[14px]', radius: 'rounded-[22px] rounded-tr-lg', width: 'sm:max-w-[13rem]', offset: 'sm:mt-1' },
] as const;

/**
 * 吹き出し1つ。順位（0起点）で大きさ・色・吹き出しの向き（角の落とし方）・
 * 上限幅・縦の段差がすべて決まる＝決定論。
 */
function Bubble({
  rank,
  text,
  onSelect,
  disabled,
}: {
  rank: number;
  text: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  const s = BUBBLE_STYLES[Math.min(rank, BUBBLE_STYLES.length - 1)];
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      style={{ animationDelay: `${rank * 380}ms` }}
      className={`animate-bubble-float max-w-full text-left transition-transform duration-200 hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 ${s.box} ${s.radius} ${s.width} ${s.offset}`}
    >
      {rank === 0 && (
        <span className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-black tracking-wide text-pop-soft">
          <NaruhodoMark height={13} />
          いちばん聞かれています
        </span>
      )}
      {/* text-balance: 「…比べてど / う？」のような不格好な行割れを防ぐ */}
      <span className={`font-round block text-balance font-black leading-[1.6] ${s.text}`}>
        {text}
      </span>
    </button>
  );
}

/** A1: 進行段階の実況ラベル（SSE 'status' イベント）。実際のパイプライン工程に対応。 */
const STAGE_LABELS: Record<string, string> = {
  search: '🔍 開示資料を検索しています…',
  plan: '📊 数値を照合し、回答方針を判定しています…',
  write: '✍️ 分析をまとめています…',
};

/** B3: ストリーミング中の本文。完成した行だけ Markdown 描画し、書きかけの最終行は
 * プレーンで出す（表や**太字**が閉じる前の崩れた中間状態を見せない＝ガタつき防止）。
 * B1: 末尾に点滅キャレットで"書かれていく"感を出す。 */
function StreamingProse({ text, streaming }: { text: string; streaming: boolean }) {
  const nl = text.lastIndexOf('\n');
  const done = nl >= 0 ? text.slice(0, nl + 1) : '';
  const rest = nl >= 0 ? text.slice(nl + 1) : text;
  return (
    <span>
      {done && <Markdown>{done}</Markdown>}
      {rest && <span className="text-[13px] leading-[1.95] text-ink-soft">{rest}</span>}
      {streaming && (
        <span className="animate-caret ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] rounded-sm bg-pop" />
      )}
    </span>
  );
}

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  response?: AgentResponse;
  isStreaming?: boolean;
  question?: string; // assistant メッセージに紐づく元の質問（IR問い合わせ記録用）
  irContactStatus?: 'sending' | 'sent' | 'error'; // 「IR窓口へ問い合わせる」の送信状態
  stage?: string; // A1: 進行段階（search/plan/write）。本文が届き始めたら不要
}

interface ChatInterfaceProps {
  /** 対象企業。銘柄URL（/c/<ticker>）がサーバー側で確定させて渡す。
   *  クライアントで選ばせないので「未選択」の状態は存在しない。 */
  company: Company;
  sessionId?: string;
  /** この企業の「おもな数字」（層1の検証済み実績）。層1が無い企業では undefined。 */
  headline?: CompanyHeadline;
  /** この企業の公式Q&A（層1から決定論で組み立て済み）。
   *  サイドパネルに常時描画され、閉じている間もHTMLに答え全文が載る＝AIの引用元になる。 */
  qa?: PublicQa[];
}

export default function ChatInterface({ company, sessionId, headline, qa = [] }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId] = useState<string | undefined>(sessionId);
  const [audience, setAudience] = useState<Audience>('standard');
  const [qaOpen, setQaOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 企業固有のガイドチップがあれば優先、無ければ汎用にフォールバック
  const chips = company.guidedQuestions ?? GUIDED_ENTRIES;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // 読者レベルはブラウザに記憶（次回訪問時も同じ設定で）。
  // 旧3段階の保存値は新2段階へ変換し、新値で書き戻す（自己清掃＝旧値はストレージに残らない）
  useEffect(() => {
    const saved = localStorage.getItem('ir-audience');
    if (!saved) return;
    const a = saved === 'casual' || saved === 'standard' ? saved : LEGACY_AUDIENCE[saved];
    if (!a) return;
    setAudience(a);
    if (a !== saved) {
      try { localStorage.setItem('ir-audience', a); } catch { /* private mode 等は無視 */ }
    }
  }, []);
  const changeAudience = (a: Audience) => {
    setAudience(a);
    try { localStorage.setItem('ir-audience', a); } catch { /* private mode 等は無視 */ }
  };

  const patchMessage = (id: string, patch: Partial<Message>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || isLoading) return;

    // 短期メモリ: 直近の会話履歴を同梱（サーバはステートレス＝毎回受け取って使い捨て）。
    // フォロー質問（「なんで？」等）をエージェント側で自己完結クエリに書き換えるのに使う。
    const history = messages
      .filter((m) => (m.type === 'user' && m.content) || (m.type === 'assistant' && m.response?.answer_prose))
      .slice(-6) // 直近3往復程度に制限（プロンプト肥大・レイテンシ対策）
      .map((m) => ({
        role: m.type,
        content: m.type === 'assistant' ? (m.response?.answer_prose ?? '').slice(0, 600) : m.content,
      }));

    const userMessage: Message = { id: Date.now().toString(), type: 'user', content: q, timestamp: new Date() };
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, userMessage, { id: assistantId, type: 'assistant', content: '', timestamp: new Date(), isStreaming: true, question: q }]);
    setInputValue('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, companyId: company.id, sessionId: currentSessionId, history, audience }),
      });
      if (!res.ok || !res.body) throw new Error('Chat request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let prose = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          if (event === 'delta') {
            prose += JSON.parse(data).text ?? '';
            patchMessage(assistantId, { content: prose });
          } else if (event === 'status') {
            // A1: 進行段階の実況（search→plan→write）
            patchMessage(assistantId, { stage: JSON.parse(data).stage });
          } else if (event === 'final') {
            const response = JSON.parse(data) as AgentResponse;
            patchMessage(assistantId, { response, content: response.answer_prose, isStreaming: false });
          }
        }
      }
    } catch (e) {
      console.error('Chat error:', e);
      patchMessage(assistantId, { content: 'エラーが発生しました。しばらくしてから再度お試しください。', isStreaming: false });
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => { setMessages([]); inputRef.current?.focus(); };

  // 「IR窓口へ問い合わせる」を押したときだけ、その質問を IR要対応として記録する
  // （自動エスカレでは記録しない＝要対応一覧の肥大化を防ぐ）。状態はメッセージ内インライン表示。
  const handleContactIR = async (messageId: string, question: string) => {
    if (!question) return;
    const msg = messages.find((m) => m.id === messageId);
    if (msg?.irContactStatus === 'sending' || msg?.irContactStatus === 'sent') return; // 二重送信防止
    patchMessage(messageId, { irContactStatus: 'sending' });
    try {
      const res = await fetch('/api/ir/contact/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company.id, question }),
      });
      if (!res.ok) throw new Error(String(res.status));
      patchMessage(messageId, { irContactStatus: 'sent' });
    } catch (e) {
      console.error('contact IR failed:', e);
      patchMessage(messageId, { irContactStatus: 'error' }); // 再送可能（ボタンに戻す）
    }
  };

  return (
    /* デスクトップでは右にQ&Aパネルが生えて二画面になる。パネルは常時DOMにあり、
       開閉はCSSのみ（閉じていてもHTMLに答え全文が載る＝AIの引用元になる）。 */
    <div className="flex h-full w-full min-h-0">
      <div className="mx-auto flex h-full w-full min-w-0 flex-1 flex-col max-w-3xl lg:max-w-4xl">
      {/* コンテキストバー */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        {/* 企業名はヘッダーのピッカーにも出るため、狭い画面ではラベルを隠して潰れを防ぐ */}
        <span className="hidden items-center gap-2 truncate text-sm text-mute sm:flex">
          <span className="h-2 w-2 rounded-full bg-pop" />
          <span className="truncate font-medium text-ink-soft">{`${companyShortName(company.name)} のIR情報`}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {/* 読者レベル: 説明のかみ砕き方だけが変わる（専門性は同じ） */}
          <div
            className="flex items-center rounded-full bg-paper p-0.5 shadow-e1"
            title="説明のかみ砕き方が変わります（内容の専門性は同じです）"
          >
            {AUDIENCES.map((a) => (
              <button
                key={a.key}
                onClick={() => changeAudience(a.key)}
                aria-pressed={audience === a.key}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-200 ${
                  audience === a.key
                    ? 'bg-ink text-cream'
                    : 'text-mute hover:text-ink'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className={`shrink-0 ${PILL_QUIET}`}
            >
              新しいチャット
            </button>
          )}
        </div>
      </div>

      {/* メッセージ */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {messages.length === 0 ? (
          (
            /* 初期画面＝「吹き出しガーデン」。デザイン: claude.ai/design「Naruhodo IR Home」。
               質問をタップするとそのまま送信される。 */
            <div className="mx-auto flex w-full max-w-3xl flex-col px-2 py-6">
              <h2 className="font-round text-[28px] font-black leading-[1.45] tracking-tight text-ink sm:text-[34px]">
                {companyShortName(company.name)}
                <span className="font-num text-[0.7em] font-semibold text-mute">
                  {`（${company.ticker}）`}
                </span>
                の IR に <span className="mk">なるほど！</span>
              </h2>

              {/* 吹き出しガーデン */}
              <h3 className="font-round mt-7 text-[15px] font-black text-ink">よく聞かれる質問</h3>
              {/* カードは文字量ぶんの幅で並び、順位ごとの上マージンで縦位置がずれる
                  （＝デザインの散らし配置。回転はかけない） */}
              <div className="mt-3.5 flex flex-wrap items-start gap-3">
                {chips.map((entry, i) => (
                  <Bubble
                    key={entry}
                    rank={i}
                    text={entry}
                    disabled={isLoading}
                    onSelect={() => send(entry)}
                  />
                ))}
              </div>

              {/* おもな数字（層1の検証済み実績）。公式Q&AのCTAは入力欄の上に常設するので
                  ここには置かない（初期画面にしか無いと、会話を始めた瞬間に消えてしまう）。 */}
              {headline && (
                <div className="mt-7 rounded-3xl bg-paper px-6 py-5 shadow-e2">
                  {/* ラベルは期間だけ。「おもな数字」は各数値にラベルが付いている以上、情報として重複。 */}
                  <div className="whitespace-nowrap text-[10.5px] font-bold text-mute">
                    {headline.period}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-baseline gap-x-7 gap-y-2">
                    {headline.numbers.map((n) => (
                      <div key={n.label} className="flex items-baseline gap-1.5">
                        <span className="text-[10.5px] font-medium text-mute">{n.label}</span>
                        <span className="font-num text-[19px] font-bold text-ink">{n.value}</span>
                        {n.yoy && (
                          <span
                            className={`text-[11px] font-bold ${
                              n.yoy.startsWith('+') ? 'text-pop' : 'text-coral-deep'
                            }`}
                          >
                            {n.yoy}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="space-y-4 py-2">
            {messages.map((m) => (
              <div key={m.id} className={`animate-fade-slide-in flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.type === 'user' ? (
                  <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[13px] font-medium leading-relaxed text-cream">
                    {m.content}
                  </div>
                ) : (
                  <div className="w-full max-w-[95%]">
                    {m.response ? (
                      <AgentAnswer
                        response={m.response}
                        irContactStatus={m.irContactStatus}
                        onContactIR={() => handleContactIR(m.id, m.question ?? '')}
                        onSuggestion={(q) => send(q)}
                      />
                    ) : (
                      m.content ? (
                        <div className="rounded-3xl bg-paper p-5 shadow-e3">
                          <StreamingProse text={m.content} streaming={!!m.isStreaming} />
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2.5 text-[12.5px] font-bold text-ink-soft shadow-e2">
                          <span key={m.stage ?? 'thinking'} className="animate-fade-slide-in">
                            {STAGE_LABELS[m.stage ?? ''] ?? '考え中'}
                          </span>
                          {m.isStreaming && (
                            <span className="inline-flex gap-1">
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pop [animation-delay:-0.3s]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pop [animation-delay:-0.15s]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pop" />
                            </span>
                          )}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 入力 */}
      <div className="px-4 pb-5 pt-1">
        {/* 公式Q&Aの導線は**入力欄の上に常設**する。初期画面の数字カードに置くと
            会話を始めた瞬間に消えてしまうが、これは会話中こそ開きたいもの
            （「その数字の出どころは？」と思ったときに手が届く）。 */}
        {qa.length > 0 && (
          <div className="mb-2 flex justify-end px-1">
            <button onClick={() => setQaOpen(true)} className={PILL_INK}>
              {`公式Q&A ${qa.length}件をみる →`}
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); send(inputValue); }}
          className="flex items-center gap-2 rounded-full bg-paper p-2 pl-5 shadow-e2 transition-shadow duration-300 focus-within:shadow-e4"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`${companyShortName(company.name)}について質問する…`}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm font-medium text-ink placeholder:text-mute focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            aria-label="送信"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pop text-white transition hover:bg-pop-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-mute"
          >
            <svg className="h-4.5 w-4.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 16V4M4.5 9.5L10 4l5.5 5.5" />
            </svg>
          </button>
        </form>
        {/* 透明性の明示: 本文は保存しない（話題等のメタデータのみ匿名記録）。
            本文がIRに送られるのは「IR窓口へ問い合わせる」を押した時のみ。 */}
        <p className="mt-2.5 px-1 text-center text-[10.5px] leading-relaxed text-mute">
          ※ 会話の本文は保存されません。話題・回答状況などの統計のみ匿名で記録し、IR活動の改善に利用します。
        </p>
      </div>
      </div>

      <QaPanel
        qa={qa}
        companyName={companyShortName(company.name)}
        open={qaOpen && qa.length > 0}
        onClose={() => setQaOpen(false)}
        onAsk={(question) => {
          setQaOpen(false); // スマホでは全面を覆っているので、送る前に閉じる
          send(question);
        }}
      />
    </div>
  );
}
