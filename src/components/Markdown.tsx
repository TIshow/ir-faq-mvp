'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * LLMの散文（Markdown）をダークテーマに合わせて描画する。
 * 生HTMLは描画しない（rehype-raw不使用＝XSS安全）。
 */
export const Markdown: React.FC<{ children: string }> = ({ children }) => (
  <div className="text-sm leading-relaxed text-zinc-200">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-2 ml-1 list-disc space-y-1 pl-4 marker:text-zinc-600">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 ml-1 list-decimal space-y-1 pl-4 marker:text-zinc-600">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
        em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-100">{children}</code>
        ),
        h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold text-zinc-100">{children}</h3>,
        h2: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-zinc-100">{children}</h3>,
        h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold text-zinc-200">{children}</h4>,
        // 生成IRの「💡 注目ポイント」節（#### 見出し）: やわらかい強調カード風に
        h4: ({ children }) => (
          <h4 className="mb-1.5 mt-4 flex items-center gap-1.5 border-t border-zinc-800/70 pt-3 text-sm font-semibold text-emerald-300">
            {children}
          </h4>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>
        ),
        hr: () => <hr className="my-3 border-zinc-800" />,
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-zinc-800 px-2 py-1 text-left font-semibold text-zinc-300">{children}</th>,
        td: ({ children }) => <td className="border border-zinc-800 px-2 py-1 text-zinc-300">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
