'use client';

import { useState, useRef, useEffect } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { companyShortName } from '@/config/companies';
import { AgentResponse } from '@/lib/agent-types';
import { AgentAnswer } from '@/components/FactCard';
import { Markdown } from '@/components/Markdown';
import { NaruhodoMark } from '@/components/BrandLogo';

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
 * 吹き出しガーデンのスタイル階層（claude.ai/design「Naruhodo IR Home」）。
 * index で決まる＝決定論。**件数の表示はしない**: 質問文を保存していないため
 * 「N人が質問」は算出できず、出せば捏造になる（プライバシー設計 CLAUDE.md）。
 * 大きさは視覚的な階層づけのみで、人気度を主張しない。
 */
const BUBBLE_STYLES = [
  { box: 'bg-ink px-6 py-5 shadow-e3', text: 'text-cream text-[19px] sm:text-[21px]', radius: 'rounded-[30px] rounded-bl-lg', rotate: '-rotate-2' },
  { box: 'bg-pop px-5 py-4 shadow-e2', text: 'text-cream text-[16px] sm:text-[17px]', radius: 'rounded-[28px] rounded-br-lg', rotate: 'rotate-2' },
  { box: 'bg-paper px-5 py-4 shadow-e2', text: 'text-ink text-[15px]', radius: 'rounded-[26px] rounded-bl-lg', rotate: '-rotate-3' },
  { box: 'bg-sun px-5 py-4 shadow-e2', text: 'text-ink text-[15px]', radius: 'rounded-[26px] rounded-tr-lg', rotate: 'rotate-3' },
  { box: 'bg-paper px-5 py-3.5 shadow-e2', text: 'text-ink text-[14.5px]', radius: 'rounded-[26px] rounded-br-lg', rotate: '-rotate-1' },
  { box: 'bg-coral/20 px-4 py-3.5 shadow-e1', text: 'text-ink text-[14px]', radius: 'rounded-[24px] rounded-bl-lg', rotate: 'rotate-2' },
  { box: 'bg-paper border-[1.5px] border-dashed border-line px-4 py-3', text: 'text-ink text-[13.5px]', radius: 'rounded-[22px] rounded-bl-lg', rotate: '-rotate-2' },
  { box: 'bg-paper border-[1.5px] border-dashed border-line px-4 py-3', text: 'text-ink text-[13.5px]', radius: 'rounded-[22px] rounded-br-lg', rotate: 'rotate-[1.5deg]' },
  { box: 'bg-paper border-[1.5px] border-dashed border-line px-4 py-3', text: 'text-ink text-[13.5px]', radius: 'rounded-[22px] rounded-tr-lg', rotate: '-rotate-[2.5deg]' },
] as const;

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
  sessionId?: string;
  /** 全企業ぶんの「おもな数字」（層1の検証済み実績）。トップ画面の初期状態で表示する。
   *  企業の選択はクライアント側で決まるため、サーバが全社ぶんを渡しておく。 */
  headline?: Record<
    string,
    { period: string; qaCount: number; numbers: { label: string; value: string; yoy: string | null }[] }
  >;
  /** 'app'（既定・/ の全画面レイアウト。自身がスクロール）/
   *  'page'（公開Q&Aページ #113 に埋め込む。ドキュメントと一緒にスクロールし、
   *   入力バーだけ画面下端に貼り付く＝チャットが常に「聞ける状態」で見えている） */
  variant?: 'app' | 'page';
}

export default function ChatInterface({ sessionId, variant = 'app', headline = {} }: ChatInterfaceProps) {
  const embedded = variant === 'page';
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId] = useState<string | undefined>(sessionId);
  const [audience, setAudience] = useState<Audience>('standard');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { selectedCompany } = useCompany();

  // 企業固有のガイドチップがあれば優先、無ければ汎用にフォールバック
  const chips = selectedCompany?.guidedQuestions ?? GUIDED_ENTRIES;

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
    if (!selectedCompany) { alert('銘柄を選択してから質問してください。'); return; }

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
        body: JSON.stringify({ message: q, companyId: selectedCompany.id, sessionId: currentSessionId, history, audience }),
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
    if (!selectedCompany || !question) return;
    const msg = messages.find((m) => m.id === messageId);
    if (msg?.irContactStatus === 'sending' || msg?.irContactStatus === 'sent') return; // 二重送信防止
    patchMessage(messageId, { irContactStatus: 'sending' });
    try {
      const res = await fetch('/api/ir/contact/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompany.id, question }),
      });
      if (!res.ok) throw new Error(String(res.status));
      patchMessage(messageId, { irContactStatus: 'sent' });
    } catch (e) {
      console.error('contact IR failed:', e);
      patchMessage(messageId, { irContactStatus: 'error' }); // 再送可能（ボタンに戻す）
    }
  };

  return (
    <div
      className={`mx-auto flex w-full flex-col ${
        embedded ? 'max-w-3xl' : 'h-full max-w-3xl lg:max-w-4xl'
      }`}
    >
      {/* コンテキストバー */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        {/* 企業名はヘッダーのピッカーにも出るため、狭い画面ではラベルを隠して潰れを防ぐ */}
        <span className="hidden items-center gap-2 truncate text-sm text-mute sm:flex">
          {selectedCompany ? (
            <>
              <span className="h-2 w-2 rounded-full bg-pop" />
              <span className="truncate font-medium text-ink-soft">{companyShortName(selectedCompany.name)} のIR情報</span>
            </>
          ) : '銘柄を選択してください'}
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
              className="shrink-0 rounded-full border-[1.5px] border-line bg-paper px-3 py-1 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
            >
              新しいチャット
            </button>
          )}
        </div>
      </div>

      {/* メッセージ */}
      <div className={embedded ? 'px-4 pb-4' : 'flex-1 overflow-y-auto px-4 pb-4'}>
        {messages.length === 0 ? (
          embedded ? (
            /* 企業ページ(#113)に埋め込むとき: 上に公式Q&Aが並んでいるので、
               見出しも吹き出しガーデンも出さず、控えめなチップだけにする（重複を避ける）。 */
            <div className="flex flex-col items-center justify-center px-2 py-6 text-center">
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {chips.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => (selectedCompany ? send(entry) : inputRef.current?.focus())}
                    disabled={!selectedCompany || isLoading}
                    className="rounded-full border-[1.5px] border-ink bg-paper px-4 py-2 text-[13px] font-bold text-ink transition-all duration-200 hover:-translate-y-px hover:bg-ink hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* トップ画面（初期状態）＝「吹き出しガーデン」。
               デザイン: claude.ai/design「Naruhodo IR Home」。
               質問をタップすると入力欄に**下書きとして入る**（すぐ送らない）ので、
               投資家は言い回しを直してから送れる。 */
            <div className="mx-auto flex w-full max-w-3xl flex-col px-2 py-6">
              <div className="inline-flex items-center gap-1.5 self-start rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-1.5 text-[11px] font-bold text-ink">
                🌱 決算のこと、なんでも聞いてください
              </div>
              <h2 className="font-round mt-4 text-[28px] font-black leading-[1.45] tracking-tight text-ink sm:text-[34px]">
                {selectedCompany ? (
                  <>
                    {companyShortName(selectedCompany.name)}
                    <span className="font-num text-[0.7em] font-semibold text-mute">
                      {`（${selectedCompany.ticker}）`}
                    </span>
                    の決算に <span className="mk">なるほど！</span>
                  </>
                ) : (
                  <>
                    銘柄を選んで <span className="mk">なるほど！</span>
                  </>
                )}
              </h2>
              <p className="mt-3 text-[12.5px] font-medium leading-[1.9] text-ink-soft">
                開示済みの決算資料と公式Q&amp;Aだけを根拠に、その場でお答えします。
                <br className="hidden sm:inline" />
                気になるものをタップ、または下の入力欄から自由に質問できます。
              </p>

              {/* 吹き出しガーデン */}
              <div className="mt-7 flex items-baseline justify-between gap-3">
                <h3 className="font-round text-[15px] font-black text-ink">気になることから、聞いてみる</h3>
                <span className="shrink-0 text-[10.5px] font-medium text-mute">タップで下書きに入ります</span>
              </div>
              <div className="mt-3.5 flex flex-wrap items-start gap-3">
                {chips.map((entry, i) => {
                  const s = BUBBLE_STYLES[i % BUBBLE_STYLES.length];
                  return (
                    <button
                      key={entry}
                      onClick={() => {
                        setInputValue(entry);
                        inputRef.current?.focus();
                      }}
                      disabled={!selectedCompany || isLoading}
                      style={{ animationDelay: `${i * 400}ms` }}
                      className={`animate-bubble-float max-w-full text-left transition-transform duration-200 hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 ${s.rotate} ${s.box} ${s.radius}`}
                    >
                      <span className={`font-round block font-black leading-[1.6] ${s.text}`}>{entry}</span>
                    </button>
                  );
                })}
              </div>

              {/* おもな数字（層1の検証済み実績）＋公式Q&Aへの導線 */}
              {selectedCompany?.ticker && headline[selectedCompany.ticker] && (
                <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-3xl bg-paper px-6 py-4 shadow-e2">
                  <div className="text-[10.5px] font-bold leading-[1.6] text-mute">
                    {headline[selectedCompany.ticker].period}
                    <br />
                    おもな数字
                  </div>
                  {headline[selectedCompany.ticker].numbers.map((n) => (
                    <div key={n.label}>
                      <div className="text-[10.5px] font-medium text-mute">{n.label}</div>
                      <div className="font-num mt-0.5 text-[19px] font-bold text-ink">
                        {n.value}
                        {n.yoy && (
                          <span
                            className={`ml-1.5 text-[11px] font-bold ${
                              n.yoy.startsWith('+') ? 'text-pop' : 'text-coral-deep'
                            }`}
                          >
                            {n.yoy}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <a
                    href={`/c/${selectedCompany.ticker}/`}
                    className="ml-auto border-b-[1.5px] border-line pb-0.5 text-[10.5px] font-bold text-mute transition hover:border-ink hover:text-ink"
                  >
                    {`公式Q&A ${headline[selectedCompany.ticker].qaCount}件をみる →`}
                  </a>
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
            <div ref={messagesEndRef} className={embedded ? "scroll-mb-40" : undefined} />
          </div>
        )}
      </div>

      {/* 入力 */}
      <div
        className={
          embedded
            ? 'fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-cream/95 px-4 pb-3 pt-3 backdrop-blur-sm'
            : 'px-4 pb-5 pt-1'
        }
      >
        {/* 固定バーの中身は、ページ本文と同じ幅に揃える */}
        <div className={embedded ? 'mx-auto w-full max-w-3xl' : 'contents'}>
        {/* 吹き出しから下書きが入ったことを知らせる（そのまま送るか、直してから送れる） */}
        {!embedded && messages.length === 0 && inputValue && (
          <p className="animate-pop-in mb-2 flex items-center gap-1.5 px-1 text-[11.5px] font-bold text-pop-deep">
            <NaruhodoMark height={14} />
            この質問を送ります（直してから送ることもできます）
          </p>
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
            placeholder={selectedCompany ? `${companyShortName(selectedCompany.name)}について質問する…` : '銘柄を選択してください'}
            disabled={isLoading || !selectedCompany}
            className="flex-1 bg-transparent text-sm font-medium text-ink placeholder:text-mute focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading || !selectedCompany}
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
    </div>
  );
}
