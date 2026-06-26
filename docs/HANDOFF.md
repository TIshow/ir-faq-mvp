# HANDOFF — 引き継ぎ（現状・実リソース・再開手順）

最終更新: 2026-06-26 / 別のエンジニア・AIがそのまま続けられるための実状ドキュメント。
設計は `ARCHITECTURE.md`、方針は `../CLAUDE.md`。

## 1. 一言でいうと今どこ
**全GCPで実稼働するマルチテナントIR Agent**。回答生成は **生成IR（既定 `ANSWER_MODE=synthesis`、`agent/synthesize.py`）** に刷新済み＝層1（数値）＋層2（定性）を統合し「業績を分析して」で**表＋セグメント分析＋会社予想の洞察**まで生成する金融コパイロット型。数値は**コード計算済みデータシート由来でLLM非経由＝決定論**（カード＋出典でクロスチェック）。**層1は ハークスレイ(7561) を旗艦に深掘り点灯**＝FY25/26実績＋3セグメント＋FY27会社予想（EDINET有報XBRLから決定論抽出、31件、`scripts/extract_facts_xbrl.py`）。ヴィス(5071)も10件。フィル/ピアズは層2のみ。**痛み②の堀＝escalation→FAQ複利ループ（冪等upsert）＋IR向けダッシュボード（BigQuery集計）＋Firebase認証（マルチテナント・owner全社）** も実装済み。**CI/CD（GitHub Actions＋ブランチ保護＋Dependabot＋CodeQL＋gitleaks）**、ダークUI＋Markdown。ハークスレイは本番デプロイ済みでデモ可能。

> **データ調達方針（確定）**: 発行体オリジン×自動取込×EDINET検証。**TDnet有料フィードは不要**（顧客の分は発行体本人が原本保有）。速報数値は短信XBRL/発行体提供、公式裏取りは無料のEDINET XBRL、定性はPDF＋想定問答。詳細は戦略プラン。

## 2. 実デプロイ済みリソース（GCP project: `hallowed-trail-462613-v1` / region: `us-central1`）
| 種別 | 名前 / ID | URL・備考 |
|---|---|---|
| フロント | Cloud Run **ir-frontend** | https://ir-frontend-255752121803.us-central1.run.app （公開） |
| エージェント | Cloud Run **ir-agent** | https://ir-agent-eyqs2m6yva-uc.a.run.app （公開=allUsers・**本番前に非公開化**） |
| LLM | Vertex AI **gemini-2.5-flash** | `gemini-3-*` は当プロジェクト未開放(404) |
| 検索アプリ | Discovery Engine engine **ir-bot-mvp-app_1750418304373** | vis/phil/peers の3データストアを束ねる |
| データストア | **vis-ir-data_1752223995110** / **philcompany-ir-data_1752224320775** / **peers-ir-data_1752651535271** / **harux-ir-data**（旗艦・engine外で自前 default_search で検索） | GENERIC・CONTENT_REQUIRED。コンソールは「AI Applications」 |
| GCS | gs://vis-ir-data, gs://philcompany-ir-data, gs://peers_ir_data, **gs://harux-ir-data**（`/pdf/2026-fy-material.pdf`） | 各 `/pdf/`（決算PDF）＋ `/qa/faq.csv`（定性Q&A。haruxはFAQ未投入） |
| 層1（数値） | `agent/data/facts.json`（`FACTS_BACKEND=json`） | 5071=10件 / **7561=31件**。本番DBは Cloud SQL **未作成**（`database/financial_facts.sql`） |
| 回答生成 | `ANSWER_MODE=synthesis`（既定・生成IR）/ `legacy`（ロールバック） | Cloud Run env で切替可。`agent/synthesize.py` |
| 分析ログ（痛み②） | BigQuery `ir_analytics.interactions` | `ANALYTICS_ENABLED=1` で記録。Q&A匿名・回答率/トレンド用（PIIなし） |
| IR要対応ワークリスト | BigQuery `ir_analytics.ir_requests`（ts/company_ticker/question） | **ユーザーがCTA「IR窓口へ問い合わせる」を押した質問のみ**。`/api/ir/contact`(未認証)が記録。自動エスカレは入れない |
| IR管理画面 | `/ir`（ダッシュボード）・`/ir/login` | 質問トレンド/**IR要対応(問い合わせ)**/FAQ管理。`/api/ir/metrics`(BQ集計)・`/api/ir/faq`(CRUD) |
| 認証 | **Firebase Auth / Identity Platform**（既存プロジェクトに追加、表示名 ir-bot-mvp） | メール/パスワード。custom claims=company/admin。owner=全社アクセス。`lib/firebase*.ts` |
| CI/CD | GitHub Actions（`.github/workflows/ci.yml`・`security.yml`）＋ **main ブランチ保護**＋ Dependabot | frontend(型/lint/build)＋agent(ruff/format/eval)＋gitleaks＋CodeQL。緑必須・PR経由 |
| Firestore / 旧フロント / Vercel | (default) / ir-bot-mvp / — | 未使用 / **削除済み** / **削除済み**（全GCP集約） |

GitHub: https://github.com/TIshow/ir-faq-mvp （main、PR #1〜#64 マージ済）。Issue #3 に経緯と残課題、#42 はFAQサジェスト(A本実装)、#46 はIRインテリジェンス epic。

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
- ✅ **1-2 IR向けダッシュボード** = 実装済み（`/ir`：質問トレンド/エスカレ/FAQ管理、BigQuery集計 `/api/ir/metrics`、Firebase認証）。

### Tier 1.5 — 生成IRの磨き込み（直近の着手候補）
- **1.5-1 カード過多の抑制**: 「業績を分析して」で全指標×全期間=30枚超のカードが出る。散文に表がある時は主要指標に絞る／表があればカード抑制。**体験に直結＝推奨スタート**。
- **1.5-2 派生指標のカード化**（成長率/CAGR/寄与度）: 現在データシートで計算済みの比率をカードにも出す。
- **1.5-3 層2本文の数値の実在照合（VERAFI型）**: 層1に無い数字を本文から拾って計算する場合、出典スパンとの実在照合ゲート＋eval拡張（中〜高リスクなので独立ステップ）。

### Tier 2 — 信頼・コンプラ
- **2-1 出口チェック**: 散文の数値が決定論値と矛盾しないかの軽量サンプル検証（重いゲートは置かない方針）。データ無し時は `escalated`＋CTA（実装済み）。
- **2-2 ガードレールのゴールデン拡充**（助言/予測/未開示の混同行列・過剰拒否も測定）。

### Tier 3 — 運用・セキュリティ・スケール
- **3-1 ir-agent 非公開化**（現状 allUsers）。フロントSAに限定 invoker＋IDトークン、または内部 ingress。Issue #3。
- **3-2 429クォータ対策**（リトライ/バックオフ）。 **3-3 CI自動デプロイ**（main→Cloud Run）。
- **3-4 層1取り込み自動化**（provisioningスクリプト／XBRL自動更新）＝発行体増加時のみ。今は手動でOK。
- **3-5 フィル/ピアズの層1投入**（`scripts/extract_facts_xbrl.py` で各社XBRLから）＝旗艦が固まった後。

### Tier 4 — 非技術（事業成功の本丸）
- **4-1 提案を「工数削減」でなく「企業価値・投資家エンゲージメント」で**（内向き象限＝解約予備軍の回避）。
- **4-2 ハークスレイをケーススタディ化**（反応・before/after）。 **4-3 課金/契約モデル**（発行体課金・データ分離を売りに）。

> 推奨スタート: **1.5-1（カード過多の抑制）** が生成IRの体験に直結。FAQ（0-1）が来たら投入。並行して 1.5-2/1.5-3 で生成IRを深掘り。

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
