'use client';

import { useEffect, useRef } from 'react';
import { PILL_QUIET } from '@/components/ui';
import type { PublicQa } from '@/lib/public-facts';

/**
 * 公式Q&A のサイドパネル（#113）。
 *
 * **常にDOMに描画し、開閉はCSSだけで行う**（条件レンダリングにしない）。
 * これは見た目の都合ではなく本機能の目的そのもの: AIクローラー（GPTBot /
 * PerplexityBot / ClaudeBot 等）はJSを実行せずHTMLを読むため、閉じている間も
 * サーバーが返すHTMLに質問と**答え全文**が含まれている必要がある。
 * クリックで開ける正当なUIなので隠しテキスト（クローキング）には当たらない。
 *
 * デスクトップ: チャットの右に生えて二画面になる（幅をアニメーション）。
 * スマホ: 右から画面を覆ってスライドインする。
 */
export function QaPanel({
  qa,
  companyName,
  open,
  onClose,
  onAsk,
}: {
  qa: PublicQa[];
  companyName: string;
  open: boolean;
  onClose: () => void;
  /** Q&Aをチャットで深掘りする（スマホではパネルを閉じてから送る） */
  onAsk: (question: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape で閉じる。スマホでは全面を覆うので、閉じる手段が「閉じる」ボタンだけだと詰む。
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    // 開いたらパネル内にフォーカスを移す（キーボード操作がチャット側に取り残されない）
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  return (
    <aside
      // 閉じている間はフォーカスも当たらないようにする（DOMには残す）
      inert={!open}
      aria-label={`${companyName}の公式Q&A`}
      className={`fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-hidden border-l-2 border-dashed border-line bg-cream transition-all duration-300 ease-out lg:static lg:z-auto lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
        open ? 'translate-x-0 shadow-e4 lg:w-[25rem] lg:shadow-none' : 'translate-x-full lg:w-0'
      }`}
    >
      <div className="flex h-full w-full flex-col lg:w-[25rem]">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <h2 className="font-round text-[15px] font-black text-ink">
            公式Q&amp;A
            <span className="ml-2 text-[11px] font-bold text-mute">{`${qa.length}件`}</span>
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="公式Q&Aを閉じる"
            className={`shrink-0 ${PILL_QUIET}`}
          >
            閉じる
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          <p className="text-[10.5px] font-medium leading-[1.8] text-mute">
            開示済みの決算資料から、数値をそのまま引いて組み立てた回答です（AIは経由していません）。
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {qa.map((q) => (
              <li key={q.id} id={q.id} className="scroll-mt-4 rounded-3xl bg-paper p-4 shadow-e2">
                <h3 className="font-round text-[13px] font-black leading-relaxed text-ink">
                  {q.question}
                </h3>
                <p className="mt-1.5 text-[12.5px] leading-[1.9] text-ink-soft">{q.answer}</p>
                {/* 出典は1つのテキストノードとして出す（Reactが隣接ノード間に差し込む
                    <!-- --> を避け、機械が素直に抽出できるようにする） */}
                <p className="mt-2.5 text-[10px] font-bold text-mute">
                  {`出典：${q.source.doc}${q.source.page ? ` p.${q.source.page}` : ''}`}
                </p>
                <button
                  onClick={() => onAsk(q.question)}
                  className="mt-2.5 border-b-[1.5px] border-line pb-0.5 text-[10.5px] font-bold text-pop-deep transition hover:border-pop-deep"
                >
                  この質問をチャットで深掘り →
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
