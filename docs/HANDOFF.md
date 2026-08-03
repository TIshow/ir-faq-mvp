# HANDOFF — 引き継ぎ（現状・実リソース・再開手順）

最終更新: 2026-07-31 / 別のエンジニア・AIがそのまま続けられるための実状ドキュメント。
設計は `ARCHITECTURE.md`、ブランド/デザインは `DESIGN.md`、方針は `../CLAUDE.md`。

## 1. 一言でいうと今どこ
**全GCPで実稼働するマルチテナントIR Agent**。回答生成は **生成IR（既定 `ANSWER_MODE=synthesis`、`agent/synthesize.py`）** に刷新済み＝層1（数値）＋層2（定性）を統合し「業績を分析して」で**表＋セグメント分析＋会社予想の洞察**まで生成する金融コパイロット型。数値は**コード計算済みデータシート由来でLLM非経由＝決定論**（カード＋出典でクロスチェック）。**層2は2角度並列検索**（質問＋「背景・要因・会社の説明」）で過去資料/想定問答の根拠も補足に取り込み、本文末尾に**💡注目ポイント**（開示事実の気づき・意見/予測禁止）。**読者レベル**（カジュアル=投資1年目向け翻訳/スタンダード=既定）で説明の翻訳度のみ調整（専門性は共通・localStorage永続・旧3段階は後方互換）。本文は**トークン逐次ストリーミング**表示（gemini-3の**thinking最小化で先頭トークン≒半減**。PLAN JSONの揺らぎは `_parse_plan_json` で恒久対処）。UIXは **Naruhodo IR ブランド（クリーム×インク×ポップ・`DESIGN.md`）**＝評決カード＋決定論チャート・蔦の成長演出・芽吹くカーソル・「！の芽」ロゴ/favicon。**短期メモリ（会話履歴）**でフォロー質問（「なんで？」「前期は？」）にも対応（履歴はブラウザ保持・サーバはステートレス）。**層1は ハークスレイ(7561) を旗艦に深掘り点灯**＝FY25/26実績＋3セグメント＋FY27会社予想（EDINET有報XBRLから決定論抽出、31件、`scripts/extract_facts_xbrl.py`）。ヴィス(5071)も10件。フィル/ピアズは層2のみ。**痛み②の堀＝escalation→FAQ複利ループ（冪等upsert）＋IR向けダッシュボード（BigQuery集計）＋Firebase認証（マルチテナント・owner全社）** も実装済み。ダッシュボードは**話題トレンド**（話題×件数。会話の**本文はどこにも保存しない**＝メタデータのみ）と **IR要対応**（CTA同意分のみ・×Nグループ化・削除可）。**誹謗中傷・暴言は入口ガードで丁寧拒否**（CTA非表示＝IRに転送されない）。派生指標（全社/セグメント利益率・売上構成比・利益寄与度）もコード計算でカード化。LLMは **gemini-3-flash-preview（global）**（eval関門通過で切替済み・ロールバックはenv一発）。**CI/CD（GitHub Actions＋ブランチ保護＋Dependabot＋CodeQL＋gitleaks）**。ハークスレイは本番デプロイ済みでデモ可能。**#113（PR #117）で「AIに引用させる」導線を追加**＝`/c/<ticker>` が**その銘柄に固定したチャットUI＋公式Q&Aパネル**（パネルは常時DOMにあり閉じていても答え全文がHTMLに載る＝JSを実行しないAIクローラーが読める）。Q&Aは層1から**コードが**組み立て**LLM非経由**。JSON-LD(FAQPage)＋robots/sitemap/llms.txt。**トップは「銘柄を選ぶ入口」に役割分離**（対話は引用できるURL上だけで起きる）。

> **データ調達方針（確定）**: 発行体オリジン×自動取込×EDINET検証。**TDnet有料フィードは不要**（顧客の分は発行体本人が原本保有）。速報数値は短信XBRL/発行体提供、公式裏取りは無料のEDINET XBRL、定性はPDF＋想定問答。詳細は戦略プラン。

## 2. 実デプロイ済みリソース（GCP project: `hallowed-trail-462613-v1` / region: `us-central1`）
| 種別 | 名前 / ID | URL・備考 |
|---|---|---|
| フロント | Cloud Run **ir-frontend** | https://ir-frontend-255752121803.us-central1.run.app （公開） |
| エージェント | Cloud Run **ir-agent** | https://ir-agent-eyqs2m6yva-uc.a.run.app （**非公開=#88完了**: invoker=フロントSAのみ。フロントが `src/lib/agent-auth.ts` のIDトークンで呼ぶ。直叩きは403） |
| LLM | Vertex AI **gemini-3-flash-preview**（`GCP_VERTEX_AI_LOCATION=global`） | 素の `gemini-3-flash` は存在せず404。us-central1 にも無い。ロールバック=`MODEL_NAME=gemini-2.5-flash`（globalで動作可）。thinking最小化で先頭トークン〜12s。json_modeでもJSON後に余分テキストを吐く揺らぎあり→`_parse_plan_json` で恒久対処済み(#105) |
| 検索アプリ | Discovery Engine engine **ir-bot-mvp-app_1750418304373** | vis/phil/peers の3データストアを束ねる |
| データストア | **vis-ir-data_1752223995110** / **philcompany-ir-data_1752224320775** / **peers-ir-data_1752651535271** / **harux-ir-data**（旗艦・engine外で自前 default_search で検索） | GENERIC・CONTENT_REQUIRED。コンソールは「AI Applications」 |
| GCS | gs://vis-ir-data, gs://philcompany-ir-data, gs://peers_ir_data, **gs://harux-ir-data**（`/pdf/2026-fy-material.pdf`） | 各 `/pdf/`（決算PDF）＋ `/qa/faq.csv`（定性Q&A。haruxはFAQ未投入） |
| 層1（数値） | `agent/data/facts.json`（`FACTS_BACKEND=json`） | 5071=10件 / **7561=31件**。本番DBは Cloud SQL **未作成**（`database/financial_facts.sql`） |
| 回答生成 | `ANSWER_MODE=synthesis`（既定・生成IR）/ `legacy`（ロールバック） | Cloud Run env で切替可。`agent/synthesize.py` |
| 分析ログ（痛み②） | BigQuery `ir_analytics.interactions` | `ANALYTICS_ENABLED=1` で記録。**本文レス＝メタデータのみ**（ts/企業/scope/カード・引用数/話題）。話題はPLAN相乗りで分類（タクソノミー14分類・agent/analytics.py） |
| IR要対応ワークリスト | BigQuery `ir_analytics.ir_requests`（ts/company_ticker/question） | **ユーザーがCTA「IR窓口へ問い合わせる」を押した質問のみ**。`/api/ir/contact`(未認証)が記録。自動エスカレは入れない |
| 解決マーカー | BigQuery `ir_analytics.ir_resolved` | ダッシュボードの「削除」＝`/api/ir/resolve`(要認証)がマーカーINSERT→一覧から除外（同一質問の重複もまとめて消える。ハード削除はstreaming bufferで不可のため） |
| 投資家向けURL | `/`（銘柄を選ぶ入口）・**`/c/<ticker>`（銘柄URL＝対話の場＋公式Q&Aパネル）** | #113/PR #117。`/c/` はSSG（ビルド時生成・実行時クエリゼロ）。AI向け配管= `robots.txt`（GPTBot等を明示許可）/ `sitemap.xml` / `llms.txt` / JSON-LD FAQPage。公式Q&Aは `lib/public-facts.ts` が層1から決定論生成（LLM不使用）。**AIへの公開は `publishOfficialQa`（既定false）でゲート＝現在はハークスレイ(7561)のみ**。他社は noindex（開発・デモ用に動きはする） |
| IR管理画面 | `/ir`（ダッシュボード）・`/ir/login` | **ポップエディトリアル刷新済み(#111)**: KPI4枚（総質問数＋前期間比/自動回答率/IR要対応/回答対象外）＋話題トレンド（タクソノミー別アイコン・色分けバー）＋**IR要対応**＋FAQ管理（新規追加/修正/削除）＋**週次チャート**。`/api/ir/metrics`(BQ集計・5クエリ並列・`prev_total`/`weekly`含む)・`/api/ir/faq`(CRUD) |
| 認証 | **Firebase Auth / Identity Platform**（既存プロジェクトに追加、表示名 ir-bot-mvp） | メール/パスワード。custom claims=company/admin。owner=全社アクセス。`lib/firebase*.ts` |
| CI/CD | GitHub Actions（`.github/workflows/ci.yml`・`security.yml`）＋ **main ブランチ保護**＋ Dependabot | frontend(型/lint/build)＋agent(ruff/format/eval)＋gitleaks＋CodeQL。緑必須・PR経由 |
| Firestore / 旧フロント / Vercel | (default) / ir-bot-mvp / — | 未使用 / **削除済み** / **削除済み**（全GCP集約） |

GitHub: https://github.com/TIshow/ir-faq-mvp （main、PR #1〜#119 マージ済）。Issue: #3 経緯と残課題 / #42 FAQサジェスト(A本実装) / #46 IRインテリジェンス epic / #67 派生指標Phase2(CAGR・ROE/ROIC=B1データ投入待ち) / **#77 戦略（足りないもの・moat・残タスクTier）** / #86-87 尖らせ方(話題フォロー・フェデレーション) / **#88-92 インフラ（#88 ir-agent非公開化=✅完了、#89 BQ東京=データ空の今が好機、#90 SA分離、#91 モデル世代管理、#92 小規模ハードニング）** / **#97 Tier A（ハークスレイ実トラフィックで複利ループ1周）** / **#98 B1（層1縦深化: 多年度+BS/CF→ROE/ROIC解禁）** / **#107 層2精度（評価セット50〜100問＋取り込み方式比較: raw/digital/layout/手動MD/XBRL併用）**。
**配信3経路（下記 Tier 1.2）**: **#113 AI引用可能な公開IRページ＝✅第1弾デプロイ済（PR #117・段階Cが残）** / **#85 MCP/APIエンドポイント（中核へ格上げ・未着手）** / **#114 埋め込みウィジェット（未着手）**。

## 3. 今の挙動（ブラウザで確認可能）
フロント URL を開く → 企業選択 → 質問:
| 質問タイプ | 結果 |
|---|---|
| 定性（faq.csv にある内容。例「業績に季節性は？」「為替の影響は？」） | ✅ 実FAQ回答＋出典（ストリーミング） |
| 分析（例「業績を分析して」）※**ハークスレイ＝旗艦** | ✅ **生成IR**: 表（売上+16.1%/営業利益+58.3%/利益率4.3→5.8%）＋セグメント別分析（中食=減収増益/物流=増収減益）＋会社予想（営業利益は減益見通し）の洞察。数値カードも併記 |
| 数値（例「前年と比べて営業利益は？」） | ✅ 営業利益3,057百万円＋**YoY+58.3%**バッジ＋出典。散文も数値を交えて分析 |
| FAQ登録済み（例「ROEの変化率は」） | ✅ 登録FAQで answered＋出典チップ（構造化数値に無い指標でもFAQ優先で接地） |
| 数値 ※ヴィス | ✅ 売上/営業利益ほか＋出典。フィル/ピアズは層1未投入で正直にエスカレ |
| 助言（買うべき？）・予測（株価上がる？）・未開示（次の決算数字） | ✅ 丁寧に拒否（scope.py 入口短絡） |
| 答えられない質問で「IR窓口へ問い合わせる」を押す | ✅ ir_requests に記録 → `/ir` の「IR要対応」に出る。**押さなければ要対応に入らない**（自動エスカレで肥大化しない） |
| 生成IRの本文 | ✅ トークン逐次ストリーミング表示（書かれていくように表示） |
| フォロー質問（「なんで？」「前期は？」「セグメント別では？」） | ✅ 短期メモリで文脈を補い会話として回答（直近の話題を維持）。フロントが直近履歴を同梱→`_contextualize` が自己完結クエリへ書き換え |
| 誹謗中傷・暴言（「クソ株」「死ね」等） | ✅ 入口ガードで丁寧に拒否（refused/inappropriate・CTA非表示＝IRに転送されない・記録もマスク/集計除外）。不満を含む正当質問（「なぜ業績が落ちた」）は通常回答 |
| 派生指標（「中食の売上構成比は？」「セグメント別の利益率は？」） | ✅ 構成比・寄与度・セグメント利益率をコード計算でカード化（`segment.<事業>.revenue_contribution` 等） |
| ダッシュボードの話題トレンド | ✅ 話題×件数のみ表示（**原文非表示**・タクソノミー別アイコン＋色分けバー）。「ROEは？」「ROEを教えて」等の表記ゆれは同一話題に自然合算 |
| ダッシュボードのKPI・週次 | ✅ 総質問数に**前期間比±**、直近4週の**週次バー**（月曜起点・0埋め）。すべて Naruhodo IR ポップエディトリアル（#111・`DESIGN.md`） |
| IR要対応の運用 | ✅ 同一質問は×Nグループ化。「削除」で解決済み化（重複ごと消える）。回答すればFAQ登録→次回から自動回答 |
| チャットUIの明示 | ✅ 「会話の本文は保存されません。話題・回答状況などの統計のみ匿名で記録し、IR活動の改善に利用します」 |
| 深掘り（最新決算×過去資料） | ✅ 2角度並列検索で過去の説明資料・IR想定問答の根拠/背景も補足材料に。本文末尾に💡注目ポイント（開示事実の気づき） |
| 読者レベル切替（カジュアル/スタンダード） | ✅ コンテキストバーで選択（localStorage永続・旧3段階の保存値は自動移行）。説明の翻訳度だけ変わり、専門性・数値・正確性は同一 |
| UIX演出（Naruhodo IR・`DESIGN.md`） | ✅ 同一指標×複数期は**決定論チャート**（予想=点線）に自動集約。回答は**蔦**（茎＋枝＋芽→末端は双葉）で育つ。カーソルはクリック可能要素で**芽吹く**。すべて表示層のみ・reduced-motionで静止 |
| 体感速度 | ✅ gemini-3 の thinking 最小化で先頭トークン≒半減（24→12s）。記録はfire-and-forgetでfinalを待たせない |
| トップ `/` | ✅ **銘柄を選ぶ入口**（対話しない）。会社カード→`/c/<ticker>/`。「続きから：〇〇」で前回の銘柄に1クリック復帰。旧 `/?c=<id>` は銘柄URLへ転送 |
| 銘柄URL `/c/7561` | ✅ ハークスレイに固定されたチャットUI。ピッカーで切替えると**URLごと移動**（`/c/5071/` 等） |
| 公式Q&Aパネル | ✅ 「公式Q&A N件をみる」→ デスクトップは右に生えて**二画面**／スマホは右から**全面カバー**。各Q&Aから「チャットで深掘り」で送信。Escapeで閉じる |
| AIから見た `/c/7561`（`curl` で確認可） | ✅ **パネルを閉じた状態のHTMLに Q&A 7件の答え全文**（52,427百万円 / +58.3% / 出典：2026年3月期 決算補足説明資料 p.4 …）＋ JSON-LD `Question` 7件 ＋ `sr-only` の h1。`/` はチャット自体を持たない（銘柄選択のみ）＝特定銘柄のページと誤解されない |
| 初期画面の吹き出しガーデン | ✅ 順位で大きさ・色が決まる（決定論）。タップで即送信。**件数は出さない**（会話本文を保存しないため質問単位の集計が存在しない） |

## 4. すぐ動作確認する（コマンド）
```bash
# ハーネスのロジック（GCP不要・常時CIで実行）
python3 eval/eval_harness.py --self-test            # → PASS

# 実数値のゼロ許容ゲート（GCP認証要・デプロイ前に実行）。緑でなければデプロイしない
uv run python3 eval/eval_harness.py --company harux # → 数値100%・コンプラ0 で PASS
uv run python3 eval/eval_harness.py --company vis

# ライブのフルスタック（定性質問）
curl -s -N -X POST https://ir-frontend-255752121803.us-central1.run.app/api/chat/ \
  -H 'Content-Type: application/json' \
  -d '{"message":"業績に季節性はありますか？","companyId":"vis"}'
# → answered / 実FAQ回答 + citations
```
ローカル起動・デプロイは `../CLAUDE.md` の §4/§5。

## 5. 次にやること（成功逆算・優先度順）
ゴール: 旗艦ハークスレイのIR室が「これめっちゃいい」、投資家が「まず聞こう」。

### Tier 0 — ハークスレイIR室レビューで刺す
- **0-1 想定問答集(FAQ)を層2へ投入**（入手待ち）。`/api/ir/faq` から冪等upsert（`harux-ir-data` に structData{question,answer}）。複利ループの投入口は実装済み、中身待ち。
- ✅ **0-2 プロンプト調整 → 生成IR化で解決**: 無指定でも最新実績＋YoY＋会社予想を統合分析（`synthesize.py`）。
- **0-3 7561向けガイド入口**（最新ハイライト/前年比/セグメント/中計/配当のチップ）= 実装済み（`companies.ts` の企業別チップ）。
- ✅ **0-4 7561ゴールデンセット＋eval CI関門**（18問・数値ゼロ許容）= 実装済み・CI緑必須。

### Tier 1 — 堀（痛み②＝発行体が金を払う理由）
- ✅ **1-1 escalation→FAQ 複利ループ** = 実装済み（冪等upsert・一覧/修正/削除。`/api/ir/faq`）。
- ✅ **1-2 IR向けダッシュボード** = 実装済み（`/ir`：KPI/話題トレンド/IR要対応/FAQ管理/週次、BigQuery集計 `/api/ir/metrics`、Firebase認証）。**ポップエディトリアルへ刷新済み(#111)**。

### Tier 1.2 — 配信（AI時代に公式回答へ到達させる3経路）※2026-07-12 の戦略レビューで新設
> **前提**: 「PDFを読んで噛み砕く」能力はコモディティ化する（Chrome内蔵のPDF要約等）。一方、汎用AI・アグリゲーターが手を出さない領域＝**発行体の業務/義務**と**「公式である」こと**。したがって戦い方を **destination（来てもらう場所）→ source（引用される情報源）** へ反転させる。3経路は弱点が異なり相補的。
>
> なお**日本のIR情報はほぼ全てPDF**でAIクローラーが解析しづらく、**中小型株はAIから見て「空白地帯」**（誤答・古い数字が返る）。ここが機会の源泉。

| 経路 | Issue | 状態 | 強み | 弱み |
|---|---|---|---|---|
| **公開IRページ**（クロール可能HTML＋JSON-LD＋llms.txt） | **#113** | **✅第1弾デプロイ済**（PR #117） | **誰の許可も要らない**・受動的に引用される・低コスト・**効果測定が容易**（公開前後で同じ質問をAIに投げて比較） | 確率的・反映に数週間 |
| **埋め込みウィジェット** | **#114** | 未着手 | **確実に届く**・自前で守れる唯一の導線・複利ループの主要流入源 | 発行体サイトに来た人しか捕まえられない |
| **MCP/APIエンドポイント** | **#85**（中核へ格上げ） | 未着手 | 能動的・リアルタイム・**最も正確**・模倣困難なネットワーク型ポジション | **利用者がコネクタを自分で追加**しないと使われない |

- 着手順の推奨: **#113 →（#114）→ #85**。#113 は既存データの再利用のみで作れ、外部の許可が不要で、効果を数字で示せる（#97 のケーススタディ素材にもなる）。
- 3経路とも**回答の一貫性**（同じ層1・同じ承認済みFAQ）と**流入元の識別**（interactions にメタデータ）を共通設計とする。会話本文を保存しない設計は不変。

**経路1（#113）の内訳**
- ✅ **1.2-1 段階B: 銘柄URL＋公式Q&Aパネル** = 完了（PR #117・本番デプロイ済）。**公開はハークスレイのみ**（`publishOfficialQa`）＝現場テストが動いている企業だけ「公式」として出す。ヴィス/フィル/ピアズは開発用でデータをリセット予定のため noindex。`/c/<ticker>` はその銘柄に固定したチャットUIで、公式Q&Aは**常時DOMに描画・開閉はCSSのみ**（閉じていても答え全文がHTMLに載る）。層1由来の決定論Q&A＋JSON-LD＋robots/sitemap/llms.txt。**トップ `/` は銘柄を選ぶ入口に分離**。
- **1.2-2 段階C: 人気順の並べ替え** — `interactions.topic`（BQ・話題別件数）で吹き出しと公式Q&Aを実績順に。**利用が少ないうちは自動更新しない**方針（企業数・投資家数が増えたら1日1回更新）。現状の並びは `companies.ts` の `guidedQuestions`（＝IR/我々の判断）で実測ではない。
- **1.2-3 段階C: 層2のFAQをパネルに載せる** — いまは層1（数値）由来のみ。想定問答（faq.csv）が入れば定性Q&Aも公開対象（Tier 0-1 待ち）。
- **1.2-4 効果測定** — AI経由の流入・引用の有無をどう観測するか（Search Console への sitemap 登録／リファラ／公開前後で同じ質問をAIに投げて比較）。**未着手だが #113 の価値を示す唯一の手段**なので優先度は高い。

### Tier 1.5 — 生成IRの磨き込み
- ✅ **1.5-1 カード過多の抑制** = 実装済み（#66: 上限8枚・超過時は最新実績1枚に畳む）。
- ✅ **1.5-2 派生指標のカード化（Phase1）** = 実装済み（#78: 構成比・寄与度・セグメント利益率）。**Phase2（CAGR・ROE/ROIC）は #67**＝多年度・BS/CF の層1投入（B1）が前提。
- **1.5-3 層2本文の数値の実在照合（VERAFI型）**: 層1に無い数字を本文から拾って計算する場合、出典スパンとの実在照合ゲート＋eval拡張（中〜高リスクなので独立ステップ）。#77 B4。

### Tier 2 — 信頼・コンプラ
- **2-1 出口チェック**: 散文の数値が決定論値と矛盾しないかの軽量サンプル検証（重いゲートは置かない方針）。データ無し時は `escalated`＋CTA（実装済み）。
- **2-2 ガードレールのゴールデン拡充**（助言/予測/未開示の混同行列・過剰拒否も測定）。

### Tier 3 — 運用・セキュリティ・スケール
- ~~3-1 ir-agent 非公開化~~＝**#88 ✅完了**（IDトークン認証＋invoker=フロントSAのみ＋レート制限10回/分。直叩き403を本番確認済み）。残り: #89 BQ東京（データ空の今が好機）・#90 SA分離・#91 モデル世代管理・#92 小規模ハードニング。
- **3-2 429クォータ対策**（リトライ/バックオフ）。 **3-3 CI自動デプロイ**（main→Cloud Run）。
- **3-4 層1取り込み自動化**（provisioningスクリプト／XBRL自動更新）＝発行体増加時のみ。今は手動でOK。
- **3-5 フィル/ピアズの層1投入**（`scripts/extract_facts_xbrl.py` で各社XBRLから）＝旗艦が固まった後。

### Tier 4 — 非技術（事業成功の本丸）
- **4-1 提案を「工数削減」でなく「企業価値・投資家エンゲージメント」で**（内向き象限＝解約予備軍の回避）。売り込みの主役は**チャットではなくIR室の業務＋公式回答の配信**（デモはダッシュボードから）。
- **4-2 ハークスレイをケーススタディ化**（反応・before/after）。 **4-3 課金/契約モデル**（発行体課金・データ分離を売りに）。
- **4-4 方向性の検証基準**（#97 実施時に観察）: IR担当者が**ダッシュボードに食いつく**→重心移動は正解／**チャットの見た目だけ褒めてダッシュボードを開かない**→業務価値が不足・作り直し／**どちらも反応が薄い**→事業として要再検討。

> 推奨スタート: 配信は **#113 の効果測定（1.2-4）**＝第1弾を本番に出した以上、AIが実際に引くかを測らないと次の投資判断ができない（sitemap の Search Console 登録＋公開前後で同じ質問をAIに投げて比較）。事業は **#97（Tier A: FAQ投入→ハークスレイで複利ループを1周）**＝堀は実利用でしか育たない（#77）。機能は **#98（B1: 層1の多年度＋BS/CF投入→CAGR/ROE/ROIC解禁。#67が下流）**。品質は **#107（層2の評価セット＋取り込み方式比較＝定性版eval関門の土台）**。インフラは #89（BQ東京・データが空の今だけ移行ゼロ）。gemini-3 は thinking 最小化で先頭〜12s（要観察・重ければ `MODEL_NAME=gemini-2.5-flash` に即戻す）。

## 6. よく使う調査コマンド
```bash
# データストア一覧（ADC quota project 設定が必要）
gcloud auth application-default set-quota-project hallowed-trail-462613-v1
TOKEN=$(gcloud auth application-default print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: hallowed-trail-462613-v1" \
 "https://discoveryengine.googleapis.com/v1/projects/hallowed-trail-462613-v1/locations/global/collections/default_collection/dataStores"

# 特定データストアの文書一覧（faq/pdf の取込確認）
curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: hallowed-trail-462613-v1" \
 ".../dataStores/vis-ir-data_1752223995110/branches/default_branch/documents?pageSize=50"

# Cloud Run ログ
gcloud run services logs read ir-agent --region us-central1 --limit 50
```

## 7. ハマりどころ（既知・対処済み）
| 症状 | 原因 | 対処 |
|---|---|---|
| Cloud Run フロント 503 | `next start` が `next.config.ts` 読込で typescript 要求（prune済） | `next.config.mjs` 化（対処済） |
| 検索が常に0件 | データストアが chunking config で `extractive_content_spec` 不可(400) | snippet_spec のみに（対処済） |
| FAQ が拾えない | faq.csv は structData{question,answer} | structData を最優先抽出（対処済） |
| 「No API key」 | uvicorn直起動で .env 未読込→ADKがAPIキー経路 | config.py で dotenv 読込＋`GOOGLE_GENAI_USE_VERTEXAI=TRUE`（対処済） |
| 403 invalid_grant（ローカルAPI） | ADC の quota project 未設定 | `gcloud auth application-default set-quota-project ...`（対処済） |
| エージェントが常にヴィスで回答 | 企業ハードコード | マルチテナント化（tool_context.state、対処済） |
| ir-agent 403（cloudbuild経由デプロイ後） | Cloud Build SA に公開設定権限なし | ローカル gcloud で allUsers invoker 付与（対処済） |
| synthesis が全部エスカレ | 生成IRの厚い散文に生の改行→`json.loads`がstrict拒否 | `json.loads(strict=False)`（対処済・synthesize.py） |
| 登録FAQが使われずエスカレ | answerability で「指標がリストに無い→false」がFAQ抜粋より優先 | can_answer 最優先=「FAQ/抜粋が直接答える→answered」（対処済・#63） |
| CI の Agent ジョブだけ失敗 | `ruff check` は通るが `ruff format --check` 未実行 | コミット前に `uv run ruff format agent eval scripts`（運用注意） |
| `/api/ir/contact` が308リダイレクト | `trailingSlash: true` 運用なのに fetch が末尾スラッシュ無し | フロントの fetch は全API末尾スラッシュ（`/api/ir/contact/` 等）に揃える |
| BQ の DELETE が "streaming buffer" エラー | streaming insert 直後の行は〜90分削除不可 | テスト行は時間をおいて DELETE（DML INSERT 分は即削除可） |
| 公開したいテキストがHTMLに出ない | 値が `useEffect` 後に決まる状態（Context等）に依存していた | サーバー側で確定させ props で渡す。props は RSC ペイロード（`<script>` 内のJS文字列）には出るがクローラーの読む本文ではない。**`curl` で実HTMLを見て確認する**（対処済・#113） |
| パネルがヘッダーの下に潜る／ドロップダウンが押せない | 親に `z-*` を付けると積み重ねコンテキストができ、中の `z-50` が外と競えない | 上に出したい要素の**親に z を付けない**。検証は**実クリック＋`elementFromPoint`**で（JSの `.click()` はヒットテストを迂回するので検証にならない）（対処済） |
| `noindex` にしたのにAIに取られる | `noindex` は**検索インデックス向け**の指示。学習・アーカイブ型（GPTBot / CCBot / meta-externalagent 等）が取得済み本文を破棄する保証はない | 学習系に効くのは robots.txt の **Disallow**。`/c/` を既定拒否＋公開銘柄だけ Allow（対処済み・#113）。取得済みのコピーは消せないので、気づいた時点で以後を止めるしかない |
| 例外文がユーザーに届く | `except Exception as e` の `str(e)` を応答に載せていた（Vertex/Discovery Engine の例外にはプロジェクトIDやデータストアIDが入りうる） | 応答から外し `logging.exception` でサーバーログへ（対処済み・#118）。ツール戻り値も同様（legacyではLLMが読むため本文に混ざりうる） |
| CodeQL `js/file-access-to-http` | facts.json 由来の質問文が fetch body に流れる | **false positive として dismiss 済**（読むのは開示済みデータで秘密情報なし・送信先は同一オリジンの自社API・送るのはユーザーが押した質問文1本） |
| gemini-3 に切替えたら 404 | 素の `gemini-3-flash` は存在しない・preview は us-central1 に無い | 実在IDは `gemini-3-flash-preview`＋`GCP_VERTEX_AI_LOCATION=global`。本番は Cloud Run env の MODEL_NAME が config 既定を上書きしている点にも注意 |
