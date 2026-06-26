'use client';

import { useState, useRef, useEffect } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { companyShortName } from '@/config/companies';
import { AgentResponse } from '@/lib/agent-types';
import { AgentAnswer } from '@/components/FactCard';

// ガイド付き入口（企業はピッカーで選択するため企業名は含めない＝スコープ安全）
const GUIDED_ENTRIES = [
  '最新の決算サマリ',
  '営業利益は前年同期比でどうでしたか？',
  'セグメント別の業績',
  '配当はどうなっていますか？',
  '中期経営計画の進捗',
];

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  response?: AgentResponse;
  isStreaming?: boolean;
  question?: string; // assistant メッセージに紐づく元の質問（IR問い合わせ記録用）
  irContactStatus?: 'sending' | 'sent' | 'error'; // 「IR窓口へ問い合わせる」の送信状態
}

interface ChatInterfaceProps {
  sessionId?: string;
}

export default function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId] = useState<string | undefined>(sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { selectedCompany } = useCompany();

  // 企業固有のガイドチップがあれば優先、無ければ汎用にフォールバック
  const chips = selectedCompany?.guidedQuestions ?? GUIDED_ENTRIES;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const patchMessage = (id: string, patch: Partial<Message>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || isLoading) return;
    if (!selectedCompany) { alert('銘柄を選択してから質問してください。'); return; }

    const userMessage: Message = { id: Date.now().toString(), type: 'user', content: q, timestamp: new Date() };
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, userMessage, { id: assistantId, type: 'assistant', content: '', timestamp: new Date(), isStreaming: true, question: q }]);
    setInputValue('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, companyId: selectedCompany.id, sessionId: currentSessionId }),
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
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      {/* コンテキストバー */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex items-center gap-2 truncate text-sm text-zinc-500">
          {selectedCompany ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="truncate text-zinc-400">{companyShortName(selectedCompany.name)} のIR情報</span>
            </>
          ) : '銘柄を選択してください'}
        </span>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="shrink-0 rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          >
            新しいチャット
          </button>
        )}
      </div>

      {/* メッセージ */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
              {selectedCompany ? (
                <>
                  <span className="text-emerald-400">{companyShortName(selectedCompany.name)}</span> について聞く
                </>
              ) : '銘柄を選んで質問しよう'}
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              開示済みのIR情報を、出典付きでお答えします。
            </p>
            <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
              {chips.map((entry) => (
                <button
                  key={entry}
                  onClick={() => (selectedCompany ? send(entry) : inputRef.current?.focus())}
                  disabled={!selectedCompany || isLoading}
                  className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-1.5 text-sm text-zinc-300 transition hover:border-emerald-500/40 hover:bg-zinc-800/80 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {entry}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.type === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-500 px-4 py-2.5 text-sm font-medium text-zinc-950">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm leading-relaxed text-zinc-200">
                    {m.response ? (
                      <AgentAnswer
                        response={m.response}
                        irContactStatus={m.irContactStatus}
                        onContactIR={() => handleContactIR(m.id, m.question ?? '')}
                        onSuggestion={(q) => send(q)}
                      />
                    ) : (
                      <span className="flex items-center gap-2 text-zinc-400">
                        {m.content || '考え中'}
                        {m.isStreaming && (
                          <span className="inline-flex gap-1">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
                          </span>
                        )}
                      </span>
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
        <form
          onSubmit={(e) => { e.preventDefault(); send(inputValue); }}
          className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-1.5 pl-4 transition focus-within:border-zinc-600"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={selectedCompany ? `${companyShortName(selectedCompany.name)}について質問する…` : '銘柄を選択してください'}
            disabled={isLoading || !selectedCompany}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading || !selectedCompany}
            aria-label="送信"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3.4 2.6a1 1 0 00-1.3 1.2l1.6 5.4a1 1 0 00.8.7l7.1 1.1-7.1 1.1a1 1 0 00-.8.7l-1.6 5.4a1 1 0 001.3 1.2l14.2-6.6a1 1 0 000-1.8L3.4 2.6z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
