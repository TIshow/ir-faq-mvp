/**
 * ボタン（ピル）の見た目の唯一の正（#126）。
 *
 * `DESIGN.md` §5 が「サジェストピル＝インク縁の白ピル、ホバーで反転」として
 * 名前を与えている表現。名前があるのに各所で手書きされ、**同じ「ピル」と呼びながら
 * 触り心地が3通りに分岐**していた（浮く/浮かない、`active:` の有無、padding）。
 * 増やすたびに4通り目が生まれるので、ここに集約する。
 *
 * `DESIGN.md` 原則4「トークンが唯一の正。生値のコピペを増やさない」の実装。
 * 新しいピルを足すときは**ここに定数を足す**（呼び出し側でクラスを書き足さない）。
 *
 * 色・影は `globals.css` の `@theme` トークンが正。ここが決めるのは
 * 「どのトークンをどう組み合わせるか」だけ。
 */

/** ピル共通の骨格（丸み・縁の太さ・太字）。単体では使わない。 */
const PILL_BASE = 'rounded-full border-[1.5px] font-bold';

/** 押したときの手触り（1px浮いて、押下で戻る）。主アクションに付ける。 */
const PILL_LIFT = 'transition-all duration-200 hover:-translate-y-px active:translate-y-0';

/** 主アクションの見た目。**サイズ違いで書き写さない**——ここを直せば全サイズに効く。 */
const PILL_INK_SKIN = 'border-ink bg-paper text-ink hover:bg-ink hover:text-cream';

/**
 * 主アクションのピル: インク縁の白地、ホバーでインク反転。
 * 例: 「公式Q&A N件をみる」/ 「＋ 新規追加」。
 */
export const PILL_INK = `${PILL_BASE} ${PILL_LIFT} ${PILL_INK_SKIN} px-3.5 py-1.5 text-[11.5px]`;

/** 主アクションのピル（大）。並べて主役に見せたいとき（次質問サジェスト）。 */
export const PILL_INK_MD = `${PILL_BASE} ${PILL_LIFT} ${PILL_INK_SKIN} px-3.5 py-2 text-xs`;

/**
 * 副次アクションのピル: 淡い縁、ホバーで縁と文字がインクへ。
 * 例: 「閉じる」「新しいチャット」。主アクションと違い**浮かない**
 * （画面から降りる操作なので、前に出る手触りを付けない）。
 */
export const PILL_QUIET = `${PILL_BASE} border-line bg-paper px-3 py-1 text-xs text-ink-soft transition hover:border-ink hover:text-ink`;

/**
 * 証券コードのチップ（銘柄ピッカー・検索候補）。
 * 数字なので `font-num`（等幅の数字書体）を当てて桁が揺れないようにする。
 */
export const CHIP_TICKER =
  'font-num shrink-0 rounded-md bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft';
