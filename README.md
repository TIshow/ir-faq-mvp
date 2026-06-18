# IR Agent

個人投資家が **選んだ上場企業の開示情報について自然言語で相談できる IR Agent**（B2B2C）。
開示済み情報のみを、**出典付きで・対話的に**答える（投資助言や未開示情報は返さない）。

> **ドキュメントの入口**
> - `CLAUDE.md` … プロジェクト指示・全体像・実行/デプロイ（AI/エンジニアはまずこれ）
> - `docs/ARCHITECTURE.md` … 設計詳細（二層グラウンディング・契約・マルチテナント）
> - `docs/HANDOFF.md` … 現状・実デプロイ済みリソース・残課題・再開手順
> - `docs/phase1-gcp-setup.md` … GCPセットアップ（既存資産の再利用版）
> - `docs/investor-experience-quality.md` … 投資家体験の品質仕様（受け入れ基準）

## アーキテクチャ（2サービス・全GCP）
```
ブラウザ → Cloud Run ir-frontend (Next.js 15 / TS)
            └ /api/chat/ → Cloud Run ir-agent (Python / Google ADK / FastAPI)
                  ├ 層1 数値: get_financial_facts（決定論。数値はLLMを通さない）
                  ├ 層2 定性: search_disclosures（Discovery Engine: PDF+FAQ、引用付き）
                  └ LLM: Vertex AI Gemini (gemini-2.5-flash)
```
- **設計の背骨**: 数値=決定論層／語り=引用付きRAG、ガードレール（助言・予測・未開示は拒否）、マルチテナント（`src/config/companies.ts` が唯一の正）。

## クイックスタート（ローカル）
```bash
# エージェント（:8080）
uv sync
cp agent/.env.example agent/.env
gcloud auth application-default login
gcloud auth application-default set-quota-project hallowed-trail-462613-v1
uv run uvicorn agent.server:app --port 8080

# フロント（:3000）
npm install
AGENT_URL=http://localhost:8080 npm run dev   # → http://localhost:3000

# 評価ハーネス（GCP不要のロジック検証）
python3 eval/eval_harness.py --self-test
```

## デプロイ（Cloud Run）
```bash
gcloud builds submit --config cloudbuild.agent.yaml         # ir-agent
gcloud run deploy ir-frontend --source . --region us-central1 --allow-unauthenticated --port 3000
gcloud run services update ir-frontend --region us-central1 \
  --update-env-vars AGENT_URL=$(gcloud run services describe ir-agent --region us-central1 --format='value(status.url)')
```

## 技術スタック
Next.js 15 / TypeScript・Google ADK (Python)・Vertex AI Gemini・Discovery Engine・Cloud Run（全GCP）。
PoCの層1数値は JSON（`agent/data/facts.json`）、本番は Cloud SQL（`database/`）に切替（`FACTS_BACKEND`）。

## 現状（2026-06）
- ✅ 全GCPで実稼働・マルチテナント切替・ガードレール・**層2の実FAQ/PDF回答（出典付き）**
- ⚠️ 層1（数値）は実データ未投入＝数値質問は「確認できません」を返す（捏造しない方針）
- 詳細・残課題は `docs/HANDOFF.md` と GitHub Issue #3
