# IR FAQ MVP

企業IR情報検索ボット - Google Vertex AI Search を活用したMVPアプリケーション

## 概要

このアプリケーションは、Google Vertex AI Search を使用して企業のIR（投資家向け広報）情報を検索・提供するWebアプリケーションです。

## 技術スタック

- **フロントエンド**: Next.js 15.3.3 + TypeScript + Tailwind CSS
- **バックエンド**: Next.js API Routes
- **検索エンジン**: Google Vertex AI Search (Discovery Engine)
- **デプロイ**: Firebase Hosting
- **認証**: 公開アクセス（β版）

## 設定情報

- **Project ID**: `ir-faq-mvp_1749712204113`
- **Search Engine ID**: `ir-faq-mvp`
- **Location**: `global`
- **Config ID**: `28e5ce10-d7d8-43ff-81f9-9316d32ac163`

## セットアップ

1. 依存関係のインストール:
```bash
npm install
```

2. 環境変数の設定:
`.env.local` ファイルが自動的に作成されています。

3. 開発サーバーの開始:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 使用方法

1. アプリケーションにアクセス
2. 中央の検索バーにIR関連の質問を入力
3. Enterキーまたは検索ボタンをクリック
4. 検索結果がモーダルで表示される

## デプロイ

Firebase Hostingへのデプロイ:
```bash
npm run deploy
```

## 機能

- 🔍 Vertex AI Search による高精度な検索
- 📱 レスポンシブデザイン
- 🌙 ダークモード対応
- ⚡ 高速なNext.js アプリケーション
- 🔒 公開アクセス（localhost、ir-faq-mvp.web.app制限）

## ディレクトリ構造

```
src/
├── app/
│   ├── api/search/          # Vertex AI Search API
│   ├── globals.css          # グローバルスタイル
│   ├── layout.tsx           # レイアウト
│   └── page.tsx             # メインページ
└── components/
    └── SearchModal.tsx      # 検索結果モーダル
```
