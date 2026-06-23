# HANDOFF — 引き継ぎ（現状・実リソース・再開手順）

最終更新: 2026-06-23 / 別のエンジニア・AIがそのまま続けられるための実状ドキュメント。
設計は `ARCHITECTURE.md`、方針は `../CLAUDE.md`。

## 1. 一言でいうと今どこ
**全GCPで実稼働するマルチテナントIR Agent**。**層2（定性・FAQ/PDF）は出典付き回答**まで到達。**層1（数値）は ハークスレイ(7561) を旗艦に深掘り点灯**＝FY25/FY26実績＋3セグメント＋FY27会社予想（**EDINET有報XBRLから決定論抽出**、31件、`scripts/extract_facts_xbrl.py`）。ヴィス(5071)も10件点灯済み（YoY/セグメント未）。フィル/ピアズは層2のみ（試験導入の見せ方）。**CI/CD（GitHub Actions＋ブランチ保護＋Dependabot）**、モダンなダークUI＋Markdown、クリック要素のポインタカーソル対応済み。ハークスレイは本番デプロイ済みでデモ可能。

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
| CI/CD | GitHub Actions（`.github/workflows/ci.yml`・`security.yml`）＋ **main ブランチ保護**＋ Dependabot | frontend(型/lint/build)＋agent(ruff/eval)＋gitleaks＋CodeQL。緑必須・PR経由 |
| Firestore / 旧フロント / Vercel | (default) / ir-bot-mvp / — | 未使用 / **削除済み** / **削除済み**（全GCP集約） |

GitHub: https://github.com/TIshow/ir-faq-mvp （main、PR #1〜#34 マージ済）。Issue #3 に経緯と残課題。

## 3. 今の挙動（ブラウザで確認可能）
フロント URL を開く → 企業選択 → 質問:
| 質問タイプ | 結果 |
|---|---|
| 定性（faq.csv にある内容。例「業績に季節性は？」「為替の影響は？」） | ✅ 実FAQ回答＋出典（ストリーミング） |
| 数値（例「営業利益は？」）※**ハークスレイ＝旗艦** | ✅ 営業利益3,057百万円・**セグメント別**（中食320/店舗2,228/物流835）・**FY27会社予想**2,800（点線枠）＋出典p.4/6/10。前年比は「前年と比べて」等で2期＋YoYバッジ |
| 数値 ※ヴィス | ✅ 売上16,253/営業利益1,915百万円ほか＋出典。フィル/ピアズは層1未投入で「確認できません」 |
| 助言（買うべき？）・予測（株価上がる？）・未開示（次の決算数字） | ✅ 丁寧に拒否 |
| フィル/ピアズ選択 | 各社データストアにスコープ（中身の投入量に依存） |

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

### Tier 0 — ハークスレイIR室レビューで刺す（最優先）
- **0-1 想定問答集(FAQ)を層2へ投入**（入手待ち）。`harux-ir-data` に structData{question,answer} で追加→手動インポート。複利ループの初期投入。
- **0-2 プロンプト調整**: 無指定「売上は？/営業利益は？」で**最新実績＋YoYバッジ＋会社予想併記**を自然に出す（現状は単期のみ。既知の癖）。
- **0-3 7561向けガイド入口**（最新ハイライト/前年比/セグメント/中計/配当のチップ）。空欄に放り込まない。
- **0-4 7561ゴールデンセット＋eval CI関門**（数値ゼロ許容）。実クライアントに誤数値を出さない保証。

### Tier 1 — 堀（痛み②＝発行体が金を払う理由）
- **1-1 escalation→FAQ 自動資産化ループの一級機能化**（質問するほど賢くなる複利資産）。
- **1-2 IR向けアウトカム・ダッシュボード**（質問トレンド/論点カバレッジ/エスカレーション/回答率）。「効果が測れない罠」を計測で先回り。

### Tier 2 — 信頼・コンプラ
- **2-1 出口チェック強化**: 散文に数値が出てカードに無い＝鉄則違反フラグ／prose二重列挙の解消（Q6）。データ無し時は `escalated`＋CTA。
- **2-2 ガードレールのゴールデン拡充**（助言/予測/未開示の混同行列・過剰拒否も測定）。

### Tier 3 — 運用・セキュリティ・スケール
- **3-1 ir-agent 非公開化**（現状 allUsers）。フロントSAに限定 invoker＋IDトークン、または内部 ingress。Issue #3。
- **3-2 429クォータ対策**（リトライ/バックオフ）。 **3-3 CI自動デプロイ**（main→Cloud Run）。
- **3-4 層1取り込み自動化**（provisioningスクリプト／XBRL自動更新）＝発行体増加時のみ。今は手動でOK。
- **3-5 フィル/ピアズの層1投入**（`scripts/extract_facts_xbrl.py` で各社XBRLから）＝旗艦が固まった後。

### Tier 4 — 非技術（事業成功の本丸）
- **4-1 提案を「工数削減」でなく「企業価値・投資家エンゲージメント」で**（内向き象限＝解約予備軍の回避）。
- **4-2 ハークスレイをケーススタディ化**（反応・before/after）。 **4-3 課金/契約モデル**（発行体課金・データ分離を売りに）。

> 推奨スタート: **0-2 → 0-4 →（FAQ来たら）0-1**。FAQ待ちの間に 0-2/0-4 を進める。

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
