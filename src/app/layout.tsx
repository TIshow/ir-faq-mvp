import type { Metadata } from "next";
import { Noto_Sans_JP, Zen_Maru_Gothic, Outfit, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// 本文: 読みやすい標準ゴシック
const notoSans = Noto_Sans_JP({
  variable: "--font-noto-sans",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

// 見出し・ブランド: 丸ゴシック（フレンドリーだが幼稚にならない太字中心）
const zenMaru = Zen_Maru_Gothic({
  variable: "--font-zen-maru",
  weight: ["500", "700", "900"],
  subsets: ["latin"],
});

// 数字: 幾何学的で視認性の高い欧文（大きな金額・比率表示用）
const outfit = Outfit({
  variable: "--font-outfit",
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
});

// 等幅: ティッカー・期間ラベル・出典など
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Naruhodo IR",
  description: "「なるほど！」が芽になる、投資家のためのIR対話エージェント。上場企業の開示済み情報を、出典付きで対話的に。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${notoSans.variable} ${zenMaru.variable} ${outfit.variable} ${plexMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
