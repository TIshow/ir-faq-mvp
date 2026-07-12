# Design — Naruhodo IR デザインシステム

ブランド・ビジュアル・演出の「正」のドキュメント。設計は `ARCHITECTURE.md`、方針は `../CLAUDE.md`。
実装上の唯一の正は **`src/app/globals.css` の `@theme` / `:root` トークン**（本書はその解説とルール）。

## 0. デザインソース（claude.ai/design）
プロジェクト **「GCP IR Agent UI設計」**（https://claude.ai/design/p/545e4f0f-ca62-4fe5-aba1-c416e736814e）
| ファイル | 内容 | 状態 |
|---|---|---|
| `IR Agent UIX Options.dc.html` | チャットUIの探索（Turn1〜3） | **Turn3「脱・金融感＝クリーム×インク×ポップ」を採用**（3a=モバイル基調＋3bエディトリアル要素。3cレシートは #98 のセグメント寄与実データ待ちで見送り） |
| `Naruhodo IR Brand.dc.html` | ブランドシート（マーク5a「！の芽」・カラー・favicon実寸） | **採用・実装済み** |
| `IR Admin Dashboard.dc.html` | IR管理画面（/ir）の刷新案 | **未実装**（現行 /ir は旧ダークテーマのまま。やるなら別PR） |

## 1. ブランド
- **プロダクト名: Naruhodo IR（なるほどIR）**。タグライン「『なるほど！』が芽になる、投資家のためのIR対話エージェント」。リポジトリ/コード内部名は従来どおり IR Agent。
- **マーク「！の芽」**: 感嘆符の軸（インク）＋点が緑の芽になり、頭から双葉（緑 #22C06A／ライトグリーン #7BE8AC）。「気づき（なるほど）が芽になる」の造形。
- **ワードマーク**: 「Naruhodo IR」= Zen Maru Gothic 900。「IR」のみグリーン（#22C06A、ダーク地では #7BE8AC）。最小サイズ: マーク単体16px、ワードマーク併記24px以上。
- **実装**: ヘッダーは `src/components/BrandLogo.tsx`（インラインSVG）。アイコンは App Router 規約で自動配信＝`src/app/icon.svg`（背景付きアプリアイコン）/ `favicon.ico`(16/32/48) / `apple-icon.png`(180)。素材は `public/brand/`（naruhodo-mark.svg / icon-512.png）。
- **再生成レシピ**: PNG/ICO は必ず **SVG から `sharp` で生成**する（`node -e "require('sharp')(svgBuffer).resize(N,N).png()..."`）。base64 の直貼りは過去にIDAT CRC破損→全ページ500を起こしたため禁止。

## 2. カラートークン（globals.css `@theme`）
| トークン | 値 | 用途 |
|---|---|---|
| `cream` | #FAF6EE | ページ背景 |
| `paper` | #FFFFFF | カード面 |
| `ink` / `ink-soft` | #26231D / #57534A | 見出し・本文／サブテキスト。ユーザー吹き出しの地 |
| `mute` / `line` | #9B958A / #E8E2D6 | ラベル・出典／罫線・非強調バー |
| `pop` / `pop-deep` / `pop-soft` | #22C06A / #1A7A46 / #7BE8AC | ブランド緑＝増加・実績ハイライト・CTA・芽 |
| `sun` / `sun-deep` / `sun-line` | #FFD666 / #C79A2E / #E5B454 | 黄＝**マーカー強調**と**会社予想**（点線枠・予バー） |
| `coral` / `coral-deep` | #FF8A66 / #C2502F | 減少・注意（YoYマイナス等） |

**意味ルール**: 緑=増加/実績/ブランド、コーラル=減少、黄=予想とマーカー。この対応は崩さない（色が情報を運ぶ）。

## 3. タイポグラフィ（next/font、layout.tsx）
| 変数 | フォント | 用途 |
|---|---|---|
| `--font-sans`（既定） | Noto Sans JP 400/500/700 | 本文 |
| `--font-round` | Zen Maru Gothic 500/700/900 | 見出し・ブランド・ラベル（900中心＝幼稚にしない） |
| `--font-num` | Outfit 500–800 | 数字（カードの大きな金額・比率・ティッカー） |
| `--font-mono` | IBM Plex Mono 400–600 | 等幅（期間ラベル等） |

## 4. エレベーション（影）
`shadow-e1 < e2 < e3 < e4`（チップ/小ボタン → 静止カード → 強調カード/フォーカス → ポップオーバー）。
生の `shadow-[...]` を書かず必ずトークンを使う（`:root` が唯一の正）。

## 5. シグネチャ表現（このプロダクトらしさ）
- **マーカー強調** `.mk`（黄）/ `.mk-green`: 太字の下に蛍光を敷くポップエディトリアルの署名。Markdown の `**太字**` は自動でマーカー化（`Markdown.tsx`）。日本語約物隣接の `**「…」**` は `remarkCjkStrong` が救済。
- **評決カード＋決定論チャート**（`FactCard.tsx` TrendCard）: **同一指標×複数期の fact_cards があるときだけ**「大きな数字＋YoYピル＋棒グラフ」に自動集約。バー高さ=実データ比、**会社予想は黄の点線**。値の加工・生成は一切しない＝**チャートも決定論**。データが無ければ出さない・「過去最高」等の演出バッジは実装しない（多年度データ #98 で決定論的に言える日まで）。
- **蔦（つる）の成長演出**: 回答左に茎（緑→ライトグリーン）が伸び、各カードが枝＋芽の節で接続、末端は双葉（＝次の質問は新しい芽）。リズムは `VINE_STEP_MS`(160ms) が唯一の正。純CSS（transform/opacity のみ・回答表示時に一度だけ再生）。
- **芽吹くカーソル**: 通常=インク矢印（尻尾に緑の点）、クリック可能=緑矢印＋双葉。`--cursor-arrow` / `--cursor-pointer`（:root）が唯一の正。SVG→PNG(Safari)→OS標準の3段フォールバック、ホットスポット(4,2)。**入力欄はI-beam・無効は not-allowed のまま**（実用性優先）。素材は `public/cursors/`。
- **出典チップ**: 「出典：資料名 p.N」のクリームチップ。全カード・参考資料で統一（ディープリンク維持）。
- **サジェストピル**: 「つぎはこれ、聞いてみる？」＝インク縁の白ピル、ホバーで反転。

## 6. モーション原則
- 種類は **transform / opacity のみ**（GPUコンポジタ・レイアウト再計算なし）。無限ループさせない（回答表示時に一度だけ）。
- キーフレーム: `fade-slide-in`（出現）/ `pop-in`（バッジ・芽）/ `bar-grow`（棒）/ `stem-grow`・`twig-grow`（蔦）/ `caret-blink`（執筆中）。
- **`prefers-reduced-motion: reduce` で全アニメ静止**（globals.css で一括）。新しいアニメを足すときは必ずこのリストにも追加する。

## 7. 原則（崩さない）
1. **演出は表示層のみ**。データ・AgentResponse契約・ガードレール・数値の決定論に触れない（チャート＝既存カードの並べ替え表示）。
2. **開示で言えないことは飾らない**（演出バッジ・推測的な装飾の禁止）。
3. **実用性 > かわいさ** の例外を守る（I-beam・not-allowed・reduced-motion）。
4. トークンが唯一の正（色・影・カーソル・蔦リズム）。生値のコピペを増やさない。

## 8. 対象外（現状）
- `/ir` IR管理画面: 旧ダークテーマのまま（デザイン案 `IR Admin Dashboard.dc.html` はあり・未実装）。
- OG画像（SNSシェア用）: 未作成。素材は `public/brand/icon-512.png` が流用可。
