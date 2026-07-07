/**
 * 画面の背景に薄く流れる「チャートライン＋ドットグリッド」の装飾レイヤ。
 * - 完全に装飾（aria-hidden・pointer-events-none）。操作・可読性を邪魔しない不透明度に抑える。
 * - 2枚を横に並べて -50% までループ移動＝境目のないシームレスな流れ。
 * - prefers-reduced-motion では停止（globals.css 側で制御）。
 */
export function AmbientBackground() {
  // ゆるやかな株価チャート風の折れ線（0-1320 x 0-320 のビューボックスで完結）
  const wave =
    'M0 190 C 60 150, 110 210, 170 175 S 290 110, 350 160 S 470 235, 530 180 S 650 95, 710 150 S 830 225, 890 165 S 1010 115, 1070 170 S 1200 215, 1260 160 S 1310 175, 1320 190';
  const wave2 =
    'M0 120 C 70 160, 130 90, 200 130 S 330 190, 400 140 S 530 70, 600 120 S 730 185, 800 135 S 930 80, 1000 130 S 1130 180, 1200 130 S 1290 105, 1320 120';

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* 上部のやわらかい光（エメラルドのグロー） */}
      <div className="absolute -top-48 left-1/2 h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-emerald-500/[0.06] blur-3xl" />
      <div className="absolute -bottom-56 right-[-200px] h-[420px] w-[720px] rounded-full bg-emerald-400/[0.04] blur-3xl" />

      {/* 流れるチャートライン（ごく薄く） */}
      <div className="absolute inset-x-0 top-[30%] h-[340px] opacity-[0.055]">
        <div className="flex h-full w-[200%] animate-bg-drift">
          {[0, 1].map((i) => (
            <svg
              key={i}
              viewBox="0 0 1320 320"
              preserveAspectRatio="none"
              className="h-full w-1/2 shrink-0"
            >
              <path d={wave} fill="none" stroke="rgb(52 211 153)" strokeWidth="2" />
              <path d={wave2} fill="none" stroke="rgb(161 161 170)" strokeWidth="1.2" />
            </svg>
          ))}
        </div>
      </div>

      {/* 幾何学ドットグリッド（逆方向へさらにゆっくり） */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div
          className="h-full w-[200%] animate-bg-drift-slow"
          style={{
            backgroundImage: 'radial-gradient(circle, #a1a1aa 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />
      </div>
    </div>
  );
}
