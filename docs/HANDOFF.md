# HANDOFF — 引き継ぎ（現状・実リソース・再開手順）

最終更新: 2026-06-18 / 別のエンジニア・AIがそのまま続けられるための実状ドキュメント。
設計は `ARCHITECTURE.md`、方針は `../CLAUDE.md`。

## 1. 一言でいうと今どこ
**全GCPで実稼働するマルチテナントIR Agent**が動いている。**層2（定性・FAQ/PDF）は実データで出典付き回答**まで到達。**層1（数値）は実データ未投入で空**（捏造しない方針なので数値質問は「確認できません」を返す）。

## 2. 実デプロイ済みリソース（GCP project: `hallowed-trail-462613-v1` / region: `us-central1`）
| 種別 | 名前 / ID | URL・備考 |
|---|---|---|
| フロント | Cloud Run **ir-frontend** | https://ir-frontend-255752121803.us-central1.run.app （公開） |
| エージェント | Cloud Run **ir-agent** | https://ir-agent-eyqs2m6yva-uc.a.run.app （公開=allUsers・**本番前に非公開化**） |
| LLM | Vertex AI **gemini-2.5-flash** | `gemini-3-*` は当プロジェクト未開放(404) |
| 検索アプリ | Discovery Engine engine **ir-bot-mvp-app_1750418304373** | 3データストアを束ねる |
| データストア | **vis-ir-data_1752223995110** / **philcompany-ir-data_1752224320775** / **peers-ir-data_1752651535271** | GENERIC・chunking config。コンソールは「AI Applications」 |
| GCS | gs://vis-ir-data, gs://philcompany-ir-data, gs://peers_ir_data | 各 `/pdf/`（決算PDF）＋ `/qa/faq.csv`（定性Q&A） |
| 層1 DB(本番用) | Cloud SQL **未作成** | `database/financial_facts.sql`。PoCはJSON(`agent/data/vis_facts.json`)で `FACTS_BACKEND=json` |
| Firestore | (default) | 旧構成の残骸・**未使用** |
| 旧フロント | Cloud Run ir-bot-mvp | **削除済み** |
| Vercel | — | **削除済み**（全GCPに集約） |

GitHub: https://github.com/TIshow/ir-faq-mvp （main、PR #1〜#10 マージ済）。Issue #3 に経緯と残課題。

## 3. 今の挙動（ブラウザで確認可能）
フロント URL を開く → 企業選択 → 質問:
| 質問タイプ | 結果 |
|---|---|
| 定性（faq.csv にある内容。例「業績に季節性は？」「為替の影響は？」） | ✅ 実FAQ回答＋出典（ストリーミング） |
| 数値（例「営業利益は？」） | ⚠️ 「正確な数値は確認できません／IRへ」（層1が空・捏造しない） |
| 助言（買うべき？）・予測（株価上がる？）・未開示（次の決算数字） | ✅ 丁寧に拒否 |
| フィル/ピアズ選択 | 各社データストアにスコープ（中身の投入量に依存） |

## 4. すぐ動作確認する（コマンド）
```bash
# ハーネスのロジック（GCP不要）
python3 eval/eval_harness.py --self-test            # → PASS

# ライブのフルスタック（定性質問）
curl -s -N -X POST https://ir-frontend-255752121803.us-central1.run.app/api/chat/ \
  -H 'Content-Type: application/json' \
  -d '{"message":"業績に季節性はありますか？","companyId":"vis"}'
# → answered / 実FAQ回答 + citations
```
ローカル起動・デプロイは `../CLAUDE.md` の §4/§5。

## 5. 次にやること（優先度順）
1. **層1の数値を点灯（ヴィス1社・深掘り）**
   - 決算PDF/XBRL から検証済み数値を抽出し `agent/data/vis_facts.json` に投入（ticカー別。捏造禁止）。
   - 併せて `eval/golden_set.vis.jsonl` の `gold_numbers`（現在空・`note`付き）を実値で埋める。
   - 目標: 「営業利益は？」が **数値カード(+YoY)+出典** で返る。`python3 eval/eval_harness.py` のCI関門（数値100%）を通す。
   - 本格化するなら **XBRL(EDINET/TDnet)を正本**に（`docs/phase1-gcp-setup.md`／Issue #3）。
2. **フィル/ピアズの中身確認 → 切替を3社の実データで総仕上げ**
   - 各データストアの文書数を確認（下記スニペット）。薄ければ GCS の /pdf・/qa から追加投入。
3. **セキュリティ: ir-agent を非公開化**（現状 allUsers）。フロントSAに限定 invoker ＋ route.ts に IDトークン送信、または内部 ingress。Issue #3。
4. **品質磨き**: 散文が数値/カードを二重列挙する傾向（プロンプトで散文を薄く=Q6）。データ無し時に `scope=answered` でなく `escalated`＋CTA にする小修正。
5. （運用）main push で自動デプロイする Cloud Build トリガー。

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
