# IR Agent — プロジェクト指示 / 引き継ぎガイド

> このファイルは AI / エンジニアが最初に読む「正」のドキュメント。
> 詳細は `docs/ARCHITECTURE.md`（設計）と `docs/HANDOFF.md`（現状・残課題・再開手順）。

## 1. これは何か
個人投資家が **選んだ上場企業の開示情報について自然言語で相談できる「IR Agent」**（B2B2C / 発行体に提供する想定）。
単なるFAQボットではなく、**開示済み情報のみを、出典付きで、対話的に深く言い換える**エージェント。

**設計の背骨（最重要・崩さない）**
- **数値はLLMの文章を経由させない**。数値は決定論的な「層1」から取得し、`fact_cards` としてUIへ直接出す。語り（散文）はLLMが書くが数値は持たせない。
- **二層グラウンディング**: 層1=構造化財務ファクト（決定論）／層2=開示文書の引用付き検索（定性）。
- **ガードレール**（コンプライアンス）: 投資助言・将来予測・未開示情報は答えない。開示済みの「会社予想」は『会社予想』と明示すれば可。不明・コーパス外は捏造せず IR 窓口へエスカレーション。
- **マルチテナント**: 対象企業はハードコードしない。リクエストごとに企業コンテキスト（ticker/name/datastore_id）を渡す。`companies.ts` が唯一の正。

## 2. アーキテクチャ（2層・2サービス）
```
ブラウザ
  └→ Cloud Run "ir-frontend"（Next.js 15 / TypeScript・UI）
        └ /api/chat/ が SSE プロキシ → AGENT_URL
             └→ Cloud Run "ir-agent"（Python / Google ADK・FastAPI・頭脳）
                  ├ 層1: get_financial_facts → 構造化ファクト（PoC=JSON / 本番=Cloud SQL）※YoY・利益率はコード計算
                  ├ 層2: search_disclosures → Discovery Engine データストア（PDF＋FAQ）
                  ├ escalate_to_ir → 質問ログ（痛み②: IRインテリジェンス）
                  └ LLM: Vertex AI Gemini（現 gemini-2.5-flash）
```
- フロントとエージェントが**別言語・別責務なので2サービス**（Next.js=画面、Python ADK=頭脳）。
- 回答契約 `AgentResponse = { answer_prose, fact_cards[], citations[], scope_status, scope_reason }`（`src/lib/agent-types.ts` と Python 側で一致）。

## 3. リポジトリ構成
```
src/                      フロント（Next.js）
  app/page.tsx, layout    画面
  app/api/chat/route.ts   エージェントへの SSE プロキシ（companies.ts から企業コンテキスト送信）
  app/api/doc/route.ts    出典PDFのプロキシ配信（非公開GCSをSA権限で中継・許可バケットのみ）
  components/ChatInterface.tsx  チャットUI（SSE受信・ストリーミング表示・次質問サジェスト）
  components/FactCard.tsx       数値カード/出典リンク/scope分岐 描画
  components/CompanyPicker.tsx  企業選択ピッカー（モノグラム＋ティッカー・ダークUI）
  components/Markdown.tsx       回答散文のMarkdown描画（react-markdown）
  config/companies.ts     企業マスター（id/name/ticker/datastoreId）＝唯一の正
  contexts/CompanyContext.tsx
  lib/agent-types.ts      AgentResponse 等の型（契約）
agent/                    エージェント（Python / ADK）
  agent.py                本体。リクエストごとに企業別 Agent 構築＋AgentResponse 合成＋ストリーミング
  tools.py                3ツール（get_financial_facts / search_disclosures / escalate_to_ir）。企業は tool_context.state から取得
  prompt.py               システムプロンプト（鉄則6項）
  scope.py                入口スコープ分類（助言/予測/未開示の短絡拒否）
  suggest.py              次質問サジェスト（A-lite: 利用可能データから決定論生成）
  analytics.py            Q&A永続ログ（痛み②: BigQuery へ匿名記録。ANALYTICS_ENABLED で切替）
  store.py / facts_store.py / db.py  層1ストア（json=PoC / cloudsql=本番 を FACTS_BACKEND で切替）
  server.py               FastAPI（/chat の SSE, /health）
  config.py               環境設定（.env 読込）
  data/facts.json     層1の実データ（ハークスレイ(7561)旗艦＋ヴィス(5071)。検証済み実値のみ／ティッカー別。捏造禁止）
  .env.example            ローカル設定例
scripts/
  extract_facts.py        層1取り込み（GeminiでPDF→構造化ファクト草案。人手検証後 facts.json へ）
  extract_facts_xbrl.py   層1取り込み（EDINET有報XBRL→決定論抽出。連結ヘッドライン＋セグメント）
eval/
  eval_harness.py         評価ハーネス（数値=決定論比較・コンプラ=ゼロ許容CI関門・--company で企業別）
  golden_set.vis.jsonl / golden_set.7561.jsonl  ゴールデンセット（vis / ハークスレイ）
database/                 層1本番用 Cloud SQL スキーマ（financial_facts.sql 等。未接続=将来）
docs/                     ARCHITECTURE.md / HANDOFF.md / phase1-gcp-setup.md / investor-experience-quality.md
Dockerfile                フロント用 / Dockerfile.agent  エージェント用
cloudbuild.yaml           フロント用 / cloudbuild.agent.yaml  エージェント用
```

## 4. ローカル実行
```bash
# エージェント（Python, port 8080）
uv sync
cp agent/.env.example agent/.env          # GOOGLE_GENAI_USE_VERTEXAI=TRUE 等を確認
gcloud auth application-default login      # Vertex/Discovery Engine 用 ADC
gcloud auth application-default set-quota-project hallowed-trail-462613-v1
uv run uvicorn agent.server:app --port 8080

# フロント（Next.js, port 3000）
npm install
AGENT_URL=http://localhost:8080 npm run dev
# → http://localhost:3000

# 評価ハーネスのロジック確認（GCP不要）
python3 eval/eval_harness.py --self-test
```

## 5. デプロイ（全て GCP / Cloud Run）
```bash
# エージェント
gcloud builds submit --config cloudbuild.agent.yaml
# フロント
gcloud run deploy ir-frontend --source . --region us-central1 --allow-unauthenticated --port 3000
# フロントに AGENT_URL を設定
gcloud run services update ir-frontend --region us-central1 \
  --update-env-vars AGENT_URL=$(gcloud run services describe ir-agent --region us-central1 --format='value(status.url)')
```
詳細・既存資産の再利用は `docs/phase1-gcp-setup.md`。

## 6. 規約・注意
- **数値を捏造しない**。層1に実データが無ければ数値は返さず層2/エスカレーションへ。
- **企業をハードコードしない**。新企業は `companies.ts` に追加し、対応する Discovery Engine データストアを用意。
- **モデルは交換可能に保つ**。`MODEL_NAME`（env / config）で切替。現状 `gemini-2.5-flash`（このプロジェクトで `gemini-3-*` は未開放）。
- コミットは小さくPRで。main 直 push しない（PR→squash merge 運用）。
- 秘密情報はコミットしない（`.env*` は gitignore、`agent/.env.example` のみ追跡）。

## 7. 現状サマリ（2026-06）
- ✅ 全GCPで実稼働（Vercel廃止）。マルチテナント切替・ガードレール・**層2の実FAQ/PDF回答（出典付き）**・モダンなダークUI（Markdown描画）が動作。
- ✅ **層1（数値）はヴィス点灯済み**＝「営業利益は？」等が数値カード＋出典で返る（`scripts/extract_facts.py`でPDF抽出→人手検証→`facts.json`）。
- ⚠️ フィル/ピアズの層1数値・ヴィスのYoY/セグメントは未投入。
- 詳細・残課題・再開手順は **`docs/HANDOFF.md`** と GitHub Issue #3。
```
GitHub: https://github.com/TIshow/ir-faq-mvp （PR #1〜#19 マージ済）
GCP project: hallowed-trail-462613-v1 / region us-central1
```
