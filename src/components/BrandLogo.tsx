import React from 'react';

/**
 * Naruhodo IR のブランドマーク「！の芽」（縦棒＝感嘆符の軸／緑の点＝その芽／2枚の葉）。
 * デザイン: claude.ai/design「Naruhodo IR Brand」5a。ライト背景（クリーム）用に軸はインク色。
 * サイズは高さ(px)で指定、幅はアスペクト比(70:96)から算出。
 */
export const NaruhodoMark: React.FC<{ height?: number; className?: string; onDark?: boolean }> = ({
  height = 32,
  className,
  onDark = false,
}) => (
  <svg
    viewBox="0 0 70 96"
    height={height}
    width={(height * 70) / 96}
    className={className}
    role="img"
    aria-label="Naruhodo IR"
  >
    <path d="M35 34 L35 62" stroke={onDark ? '#FAF6EE' : '#26231D'} strokeWidth="14" strokeLinecap="round" />
    <circle cx="35" cy="84" r="8" fill="#22C06A" />
    <path d="M35 26 C35 16 26.5 12 18.5 13 C19.5 22 26.5 27 35 26 Z" fill="#22C06A" />
    <path d="M35 26 C35 16 43.5 12 51.5 13 C50.5 22 43.5 27 35 26 Z" fill="#7BE8AC" />
  </svg>
);

/**
 * ロゴロックアップ: マーク＋ワードマーク「Naruhodo IR」（IR はグリーン）。
 * ワードマークは Zen Maru Gothic 900（globals の --font-round）。
 */
export const BrandLogo: React.FC<{ markHeight?: number; className?: string }> = ({ markHeight = 30, className }) => (
  <span className={`flex items-center gap-2.5 ${className ?? ''}`}>
    <NaruhodoMark height={markHeight} />
    <span className="font-round text-[17px] font-black leading-none tracking-tight text-ink">
      Naruhodo <span className="text-pop">IR</span>
    </span>
  </span>
);
