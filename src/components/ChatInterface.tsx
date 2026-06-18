'use client';

import { useState, useRef, useEffect } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { AgentResponse } from '@/lib/agent-types';
import { AgentAnswer } from '@/components/FactCard';

// ガイド付き入口（企業はセレクタで選択するため企業名は含めない＝スコープ安全）
const GUIDED_ENTRIES = [
  '最新の決算サマリを教えてください',
  '営業利益は前年同期比でどうでしたか？',
  'セグメント別の業績を教えてください',
  '配当はどうなっていますか？',
  '中期経営計画の進捗を教えてください',
];

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;            // ユーザー文 / アシスタントのストリーミング中 prose
  timestamp: Date;
  response?: AgentResponse;   // 確定した構造化回答（アシスタント）
  isStreaming?: boolean;
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

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  const patchMessage = (id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    if (!selectedCompany) {
      alert('企業を選択してから質問してください。');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(), type: 'user', content: inputValue.trim(), timestamp: new Date(),
    };
    const assistantId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantId, type: 'assistant', content: '', timestamp: new Date(), isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // next.config.ts の trailingSlash:true に合わせ末尾スラッシュ（308リダイレクト回避）
      const res = await fetch('/api/chat/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          companyId: selectedCompany.id,
          sessionId: currentSessionId,
        }),
      });

      if (!res.ok || !res.body) throw new Error('Chat request failed');

      // SSE をパース: "event: <name>\ndata: <json>\n\n"
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
            const { text } = JSON.parse(data);
            prose += text ?? '';
            patchMessage(assistantId, { content: prose });
          } else if (event === 'final') {
            const response = JSON.parse(data) as AgentResponse;
            patchMessage(assistantId, { response, content: response.answer_prose, isStreaming: false });
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      patchMessage(assistantId, {
        content: 'エラーが発生しました。しばらくしてから再度お試しください。',
        isStreaming: false,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    inputRef.current?.focus();
  };

  const handleContactIR = () => {
    // PoC: CTA。本番は IR 連絡フォーム/チケットへ。
    alert('IR窓口へのお取り次ぎを受け付けました。');
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">IR太郎</h1>
        <button
          onClick={clearChat}
          className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          新しいチャット
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {selectedCompany
                ? `${selectedCompany.name}の開示済みIR情報についてお答えします`
                : '企業を選択してご質問ください'}
            </p>
            <div className="grid gap-2 max-w-md mx-auto text-sm">
              {GUIDED_ENTRIES.map((entry) => (
                <button
                  key={entry}
                  onClick={() => setInputValue(entry)}
                  disabled={!selectedCompany}
                  className="p-2 text-left text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {entry}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-3xl p-3 rounded-lg ${
                  message.type === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                }`}
              >
                {message.type === 'assistant' && message.response ? (
                  <AgentAnswer response={message.response} onContactIR={handleContactIR} />
                ) : (
                  <div className="whitespace-pre-wrap">{message.content || '考え中...'}</div>
                )}

                {message.isStreaming && (
                  <div className="flex items-center mt-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={selectedCompany ? `${selectedCompany.name}についてご質問ください...` : '企業を選択してから質問してください...'}
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
            disabled={isLoading || !selectedCompany}
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading || !selectedCompany}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  );
}
