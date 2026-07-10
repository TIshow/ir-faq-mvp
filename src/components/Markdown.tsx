'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CJK強調の取りこぼし救済プラグイン。
 * CommonMark仕様では「」等の約物に隣接する **…** が強調として成立しないことがある
 * （例: 「配当性向30%」を → 閉じ**の直前が」・直後がかな だと不成立）。
 * パース後のASTを走査し、テキストノードに残った **…** を strong ノードへ変換する。
 * 生HTMLは一切生成しない（XSS安全性は不変）。コード/インラインコードは対象外
 * （mdast では code ノードの中身は children でなく value のため自然に触れない）。
 */
const CJK_STRONG_RE = /\*\*([^*\n]+?)\*\*/g;

function remarkCjkStrong() {
  const transform = (node: any): void => {
    if (!Array.isArray(node.children)) return;
    node.children = node.children.flatMap((child: any) => {
      transform(child);
      if (child.type !== 'text' || !child.value?.includes('**')) return [child];
      const parts: any[] = [];
      let last = 0;
      CJK_STRONG_RE.lastIndex = 0;
      for (let m = CJK_STRONG_RE.exec(child.value); m; m = CJK_STRONG_RE.exec(child.value)) {
        if (m.index > last) parts.push({ type: 'text', value: child.value.slice(last, m.index) });
        parts.push({ type: 'strong', children: [{ type: 'text', value: m[1] }] });
        last = m.index + m[0].length;
      }
      if (parts.length === 0) return [child];
      if (last < child.value.length) parts.push({ type: 'text', value: child.value.slice(last) });
      return parts;
    });
  };
  return transform;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * LLMの散文（Markdown）をポップエディトリアル調で描画する。
 * - 太字（**…**）はマーカー強調（黄色の蛍光を下に敷く）＝キー数値が誌面のように目立つ
 * - 見出しは丸ゴシック（Zen Maru Gothic）
 * - 生HTMLは描画しない（rehype-raw不使用＝XSS安全）
 */
export const Markdown: React.FC<{ children: string }> = ({ children }) => (
  <div className="text-[13px] leading-[1.95] text-ink-soft">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCjkStrong]}
      components={{
        p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-2 ml-1 list-disc space-y-1 pl-4 marker:text-mute">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 ml-1 list-decimal space-y-1 pl-4 marker:text-mute">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        strong: ({ children }) => <strong className="mk font-bold text-ink">{children}</strong>,
        em: ({ children }) => <em className="italic text-ink-soft">{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-pop-deep underline underline-offset-2 hover:text-pop">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
        ),
        h1: ({ children }) => <h3 className="font-round mb-1.5 mt-4 text-[15px] font-black text-ink first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="font-round mb-1.5 mt-4 text-[14px] font-black text-ink first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="font-round mb-1 mt-3 text-[13px] font-black text-ink">{children}</h4>,
        // 生成IRの「💡 注目ポイント」節（#### 見出し）: 黄色マーカーのコールアウト見出し
        h4: ({ children }) => (
          <h4 className="font-round mb-1.5 mt-4 border-t-2 border-dashed border-line pt-3.5 text-[13px] font-black text-ink">
            <span className="mk">{children}</span>
          </h4>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-[3px] border-pop pl-3 text-ink-soft">{children}</blockquote>
        ),
        hr: () => <hr className="my-3 border-line" />,
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b-2 border-line bg-cream px-2.5 py-1.5 text-left font-bold text-ink">{children}</th>
        ),
        td: ({ children }) => <td className="border-b border-line px-2.5 py-1.5 text-ink-soft last:border-b-0">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
