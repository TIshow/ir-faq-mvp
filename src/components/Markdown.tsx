"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
      if (child.type !== "text" || !child.value?.includes("**")) return [child];
      // `matchAll` は内部で正規表現を複製するので、共有している `CJK_STRONG_RE` の
      // `lastIndex` を汚さない（`exec` ループだと手動リセットが要り、忘れると
      // 2回目以降の呼び出しが途中から走る）。
      const parts: any[] = [];
      let last = 0;
      for (const m of child.value.matchAll(
        CJK_STRONG_RE,
      ) as Iterable<RegExpMatchArray>) {
        const index = m.index ?? 0;
        if (index > last)
          parts.push({ type: "text", value: child.value.slice(last, index) });
        parts.push({
          type: "strong",
          children: [{ type: "text", value: m[1] }],
        });
        last = index + m[0].length;
      }
      if (parts.length === 0) return [child];
      if (last < child.value.length)
        parts.push({ type: "text", value: child.value.slice(last) });
      return parts;
    });
  };
  return transform;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 本文中の見出し（h1/h2 の描画先）。差はサイズだけなのでここに集約する。 */
const Heading: React.FC<{ size: string; children?: React.ReactNode }> = ({
  size,
  children,
}) => (
  <h3
    className={`font-round mb-1.5 mt-4 ${size} font-black text-ink first:mt-0`}
  >
    {children}
  </h3>
);

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
        ul: ({ children }) => (
          <ul className="my-2 ml-1 list-disc space-y-1 pl-4 marker:text-mute">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 ml-1 list-decimal space-y-1 pl-4 marker:text-mute">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        strong: ({ children }) => (
          <strong className="mk font-bold text-ink">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-ink-soft">{children}</em>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-pop-deep underline underline-offset-2 hover:text-pop"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-[0.85em] text-ink">
            {children}
          </code>
        ),
        // **見出しは段下げして描画する**（h1/h2 → h3、h3/h4 → h4）。
        // 回答本文はページの中の一要素なので、ページ側の見出し階層と competing しないようにする。
        // 見た目のサイズだけが違い、クラスの残りは共通なので `Heading` に寄せる。
        h1: ({ children }) => <Heading size="text-[15px]">{children}</Heading>,
        h2: ({ children }) => <Heading size="text-[14px]">{children}</Heading>,
        h3: ({ children }) => (
          <h4 className="font-round mb-1 mt-3 text-[13px] font-black text-ink">
            {children}
          </h4>
        ),
        // 生成IRの「💡 注目ポイント」節（#### 見出し）: 黄色マーカーのコールアウト見出し
        h4: ({ children }) => (
          <h4 className="font-round mb-1.5 mt-4 border-t-2 border-dashed border-line pt-3.5 text-[13px] font-black text-ink">
            <span className="mk">{children}</span>
          </h4>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-[3px] border-pop pl-3 text-ink-soft">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-line" />,
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b-2 border-line bg-cream px-2.5 py-1.5 text-left font-bold text-ink">
            {children}
          </th>
        ),
        // **最後の「行」の下線だけ消す**（外枠の rounded-xl border と二重になるため）。
        // `last:border-b-0` と書くと `td:last-child`＝**行内の最後のセル**に効いてしまい、
        // 全行の右端だけ線が消える＝横線が右端まで届かない（#172）。
        // 消したいのは行単位なので、親の `tr` が最後かで判定する。
        td: ({ children }) => (
          <td className="border-b border-line px-2.5 py-1.5 text-ink-soft [tr:last-child>&]:border-b-0">
            {children}
          </td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
