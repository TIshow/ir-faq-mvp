/**
 * 情報の出所を示すバッジ（#145）— **「公式IR / 非公式IR」の見た目の唯一の正**。
 *
 * **公式IR** = 発行体が導入済み。EDINETの数値に加えて決算説明資料・想定問答を根拠にでき、
 *   答えられない質問はIR窓口へ取り次げる。
 * **非公式IR** = EDINET提出書類だけ。数値には出典つきで答えられるが、
 *   「なぜ」は会社の説明を持たないため答えられない（推測もしない・#151）。
 *
 * 「公式」は発行体の承認を含意する表現なので（#124）、承認の無い企業に使わない。
 * ただし数値そのものは会社自身が国に提出した正本なので、出せないわけではない——
 * だから隠すのではなく**区別する**。
 *
 * `ui.ts`（#126）と同じ理由でここに集約する: 同じ概念を各所で手書きすると、同じ名前で
 * 呼びながら見た目が分岐する。実際チャット画面・トップ・検索候補で3通りに分かれていた。
 *
 * **出す・出さないは呼び出し側が決める**（この部品は真偽値を受け取るだけ）。
 * 検索候補では公式だけを目印に出す——3,829件中3,825件が非公式なので、
 * 既定を全行に書いても選ぶ助けにならない。
 */
export function TierBadge({ official, size = 'md' }: { official: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      title={
        official
          ? 'この企業のIR部門が導入済みです。決算説明資料などの自社資料も根拠にしています。'
          : 'EDINETに提出された有価証券報告書の数値のみを根拠にしています。会社の説明資料は含みません。'
      }
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-bold ${
        size === 'sm' ? 'px-1.5 py-px text-[9.5px]' : 'px-2 py-0.5 text-[10px]'
      } ${official ? 'bg-pop/15 text-pop-deep' : 'border border-line bg-paper text-mute'}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${official ? 'bg-pop' : 'bg-mute'}`} />
      {official ? '公式IR' : '非公式IR'}
    </span>
  );
}
