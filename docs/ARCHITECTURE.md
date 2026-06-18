# Architecture

IR Agent の設計詳細。背景・方針は CLAUDE.md、現状/再開手順は HANDOFF.md。

## 全体像
```
個人投資家(ブラウザ)
   │  自然言語の質問 + 選択した企業
   ▼
[ir-frontend]  Cloud Run / Next.js 15 + TypeScript
   │  POST /api/chat/  (companies.ts から ticker/name/datastoreId を付与)
   │  → SSE をそのままプロキシ (AGENT_URL)
   ▼
[ir-agent]  Cloud Run / Python + Google ADK + FastAPI
   │  run_agent_stream(query, company)
   ├─ [1] 入口スコープ分類 scope.classify_scope（助言/予測/未開示を短絡拒否）
   ├─ [2] 企業別 Agent を構築（プロンプト＋利用可能データのヒント）。session 状態に company を seed
   ├─ ADK Runner 実行（LLM がツールを選択）:
   │     - get_financial_facts → 層1（決定論。YoY/利益率はコード計算）
   │     - search_disclosures  → 層2（Discovery Engine: PDF + FAQ、引用付き）
   │     - escalate_to_ir      → 質問ログ（捏造せずIRへ）
   ├─ [3] 合成: 数値は fact_cards（ツール戻り値から）/ 語りは LLM / 出典は citations
   │     → scope_status を確定（answered/refused/escalated）
   ▼
   SSE で {prose_delta...} → {final: AgentResponse}
```

## 二層グラウンディング（最重要原則）
| 層 | 役割 | ソース | 実装 | 鉄則 |
|---|---|---|---|---|
| **層1** | 数値（営業利益・売上・配当・セグメント等） | 構造化財務ファクト | `agent/store.py`→`facts_store`(JSON, PoC) / `db`(Cloud SQL, 本番) | **数値はLLMを通さず**ツール戻り値→`fact_cards`としてUI直送。YoY/利益率はコード計算 |
| **層2** | 定性（なぜ/背景/方針）、FAQ | 開示文書（PDF）＋ IR想定問答(faq.csv) | `agent/tools.py::search_disclosures` → Discovery Engine | 必ず引用(citations)付き。FAQは構造化(structData)から、PDFはsnippetから抽出 |

## 回答契約 AgentResponse
`src/lib/agent-types.ts`（TS）と `agent/agent.py`（Python合成）で一致させる:
```ts
AgentResponse = {
  answer_prose: string          // LLMの語り（数値は薄め）
  fact_cards: FactCard[]        // 層1由来の数値（出典付き）。出典なしカードは描画しない
  citations: Citation[]         // 層2由来の出典（doc/page/url/quote）
  scope_status: 'answered' | 'refused' | 'escalated'
  scope_reason?: 'advice' | 'prediction' | 'undisclosed' | 'out_of_corpus' | 'unknown'
}
FactCard = { metric, metricKey, period, value, valueNumeric, unit, yoy?, consolidated, basis:'actual'|'forecast', source: Citation }
```

## マルチテナント（企業切替）
- フロント `companies.ts` が唯一の正（id/name/ticker/datastoreId/isActive）。
- route.ts → server.py へ `companyTicker / companyName / datastoreId` を送る。
- `run_agent_stream(query, company)` が:
  - 企業名＋利用可能データを差し込んだ**企業別プロンプト**で Agent を構築
  - **セッション状態 `state["company"]`** に企業を seed（session_id に ticker を含め混在防止）
- ツールは `tool_context.state["company"]` から ticker / datastore_id を取得（ハードコードなし）。
- データが無い企業は捏造せず「データなし」＋エスカレーション（クロス企業漏れなし）。

## ガードレール（多層防御）
1. **入口** `scope.py`: 明白な 助言/予測/未開示 を正規表現で短絡拒否（LLM呼ばず）。「会社予想」は通す。
2. **生成** `prompt.py` 鉄則6項: 開示事実のみ・数値はツールのみ・出典必須・助言/予測しない・未開示言及せず・不明はIR案内。
3. **出口** `agent.py::_compose`: 出典なしカード除去、scope_status 確定。

## 評価（eval/eval_harness.py）
- **数値はコードで決定論比較**（`numbers_match`）、定性は LLM-judge（フック）。
- CI関門（ゼロ許容）: 数値一致率100% ＋ 助言/未開示の誤回答0件。
- 品質eval しきい値: depth/educational/tone/followup（`docs/investor-experience-quality.md`）。
- `--self-test` でハーネスのロジックを GCP 無しで検証。

## デプロイ構成
| サービス | 種別 | ビルド/デプロイ | 公開 |
|---|---|---|---|
| ir-frontend | Cloud Run (Next.js) | `Dockerfile` / `cloudbuild.yaml` / `gcloud run deploy --source` | allUsers（公開UI） |
| ir-agent | Cloud Run (Python) | `Dockerfile.agent` / `cloudbuild.agent.yaml` | allUsers（**本番は非公開化推奨**） |
- `next.config.mjs`（**.tsだとCloud Run実行時にtypescript依存で503**になるため .mjs）。
- フロント↔エージェントは `AGENT_URL` env で接続。
- エージェントの Vertex/Discovery Engine 認証は Cloud Run ランタイムSA（デフォルトCompute SAが既に権限保有）。

## 既知の設計上の注意（ハマりどころ）
- Discovery Engine データストアが **chunking config** のため、検索リクエストに `extractive_content_spec` を入れると **400**。**snippet_spec のみ**にする（`tools.py` 済）。
- FAQ(faq.csv)は **structData{question,answer}** として取り込まれる。`search_disclosures` は structData を最優先で読む。
- ローカルで discoveryengine API を叩くには ADC に quota project 設定が必要（`gcloud auth application-default set-quota-project`）。Cloud Run 上はランタイムSAなので不要。
- `gemini-3-*` はこのプロジェクト未開放（404）。`gemini-2.5-flash` を使用。
