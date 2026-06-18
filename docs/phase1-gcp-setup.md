# Phase 1 PoC セットアップ手順（既存GCP資産の再利用版）

対象: 株式会社ヴィス(5071) 1社で「二層グラウンディング＋ガードレール＋評価」を証明する。
方針の全体像は `~/.claude/plans/1-2026-6-crispy-blanket.md`、品質基準は `docs/investor-experience-quality.md`。

> 前提: 1年前のGCP（プロジェクト `hallowed-trail-462613-v1`）が**そのまま残っている**。
> 本手順は**新規作成ではなく「再利用＋差分追加」**。新しいプロジェクトは作らない。
> ⚠️ GCPリソースを変更する操作です。各自の認証・承認のもとで実行してください。

```bash
export PROJECT_ID=hallowed-trail-462613-v1
export REGION=us-central1
gcloud config set project "$PROJECT_ID"
```

---

## A. アーキテクチャ（確定）

- **モノレポ**: 本リポに Python の ADK エージェントを `agent/` として追加（既存 uv / Python 3.12）。Next.js=フロント、`agent/`=本体。
- **デプロイ先**: PoC=**Cloud Run**（既存運用）／本番=Agent Engine。
- **リトリーバ**: PoC=**既存 Discovery Engine データストア再利用**（`vis-ir-data_1752223995110`）／本番=RAG Engine＋Layout Parser。

---

## A-0. まず棚卸し（verify）— 何が生きているか確認

1年放置の課金・休止・API更新の影響を確認してから差分を入れる。

```bash
# Cloud SQL インスタンス（起動/課金状態）
gcloud sql instances list

# 有効API
gcloud services list --enabled | grep -E "aiplatform|discoveryengine|sqladmin|secretmanager|storage|run"

# 既存サービスアカウント（去年の ir-faq-service 等）
gcloud iam service-accounts list

# 既存 Cloud Run（旧 ir-bot-mvp が公開のまま生きていないか）
gcloud run services list --region="$REGION"

# Discovery Engine データストア（ヴィスが残っているか）
#   gcloud版が古い場合はコンソール: Agent/Search > Data Stores で vis-ir-data_... を確認
gcloud discovery-engine data-stores list --location=global 2>/dev/null || echo "※コンソールで確認"

# Gemini 3 のモデルアクセス（このプロジェクト/リージョンで gemini-3-flash が使えるか）
#   → Vertex AI Model Garden / コンソールで確認
```

### 再利用 / 追加 / 整理 早見表

| 資産 | 判定 | 対応 |
|---|---|---|
| Discovery Engine `vis-ir-data_…` | ✅ そのまま再利用 | 層2リトリーバ。投入済みデータを使う |
| Cloud SQL `ir-faq-db` | ❌ 消滅（`Listed 0 items`） | **PoCは不要**。層1は JSON(`agent/data/facts.json`) で代替。Cloud SQL/BigQuery は本番で新設 |
| Vertex AI（aiplatform=Agent Platform API） | ✅ 再利用 | モデルを Gemini 3 に差し替え（B-3で確認） |
| SA `ir-faq-service` | ✅ 再利用 | 不足ロールを**追加**（B-4） |
| Cloud Run `ir-bot-mvp` | ✅ 稼働中 | フロント再デプロイ先。エージェントは別サービス追加 |
| GCS `gs://vis-ir-data` | ✅ PDF配置済 | 出典URLに流用（B-5は実質不要） |
| Firestore (default) | ⏸ 不要化 | 新設計で未使用。**放置可** |

> **層1は Cloud SQL 必須ではない。** 必須なのは「検証済みの構造化ソースから決定論的に数値を引く」原則で、
> PoC（1社・数十件・読取専用）は JSON ファイル(`agent/data/facts.json`, `FACTS_BACKEND=json`)で十分。
> Cloud SQL は本番（多発行体・大量・同時書込・集計）で `FACTS_BACKEND=cloudsql` に切替。

---

## B. 差分だけを入れる（追加・変更）

> **PoCでやること**: B-3（API）/ B-4（SA）/ B-5（PDFはGCS済）/ C（JSONにファクト投入）/ D（エージェント）。
> **B-1・B-2（Cloud SQL）は本番のみ**（`FACTS_BACKEND=cloudsql`）。PoCはJSONなので**スキップ**。
> 旧 `ir-faq-db` は消滅済のため、git履歴の旧パスワードは「死んだ鍵」＝実害なし（履歴スクラブは任意）。

### B-1.（本番のみ）DBパスワードのローテーション → Secret Manager

git履歴に旧パスワードが残るため、本番でCloud SQLを使う場合は**必ず再発行**してから登録する。

```bash
# 1) Cloud SQL ユーザーのパスワードを再発行（ローテーション）
gcloud sql users set-password ir_app_user \
  --instance=ir-faq-db --prompt-for-password

# 2) Secret Manager へ（API未有効なら先に enable）
gcloud services enable secretmanager.googleapis.com   # 未有効時のみ
printf '%s' 'NEW_ROTATED_PASSWORD' | \
  gcloud secrets create ir-faq-db-password --data-file=- 2>/dev/null || \
printf '%s' 'NEW_ROTATED_PASSWORD' | \
  gcloud secrets versions add ir-faq-db-password --data-file=-
```

### B-2.（本番のみ）層1スキーマを Cloud SQL に適用
> PoCはJSON(`agent/data/facts.json`)なのでスキップ。本番でCloud SQL新設時に適用。

```bash
export DB_PASSWORD="$(gcloud secrets versions access latest --secret=ir-faq-db-password)"

# 既存 schema.sql は適用済み想定。financial_facts.sql のみ追加
#   （financial_facts は既存 companies/documents と update_updated_at_column() に依存）
gcloud beta sql connect ir-faq-db --user=ir_app_user --database=ir_faq \
  < database/financial_facts.sql
```

### B-3. 不足APIの有効化 ＋ Gemini 3 確認

```bash
# A-0 で未有効だったものだけ enable（既に有効ならスキップされる）
gcloud services enable \
  aiplatform.googleapis.com \
  discoveryengine.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com
# → Model Garden で gemini-3-flash の利用可否/リージョンを確認（agent/config.py の MODEL_NAME）
```

### B-4. 既存SAに不足ロールを追加（新規作成しない）

```bash
# 去年の SA を再利用（無ければ作成）。例として ir-faq-service を使う
export SA_EMAIL="ir-faq-service@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create ir-faq-service --display-name="IR Agent SA"

# エージェントに不足しがちなロールだけ追加
for ROLE in \
  roles/aiplatform.user \
  roles/discoveryengine.viewer \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/storage.objectViewer ; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE"
done
```

### B-5. ヴィスPDFの配置先（既存バケット再利用 or 作成）

```bash
# 既存バケットがあれば再利用。無ければ作成
export BUCKET="gs://${PROJECT_ID}-ir-docs"
gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "$BUCKET" --location="$REGION"

gcloud storage cp ./vis-pdfs/*.pdf "${BUCKET}/vis/"
# → 各PDFのURLを FactCard.source.url に（#page=N でディープリンク）
```

---

## C. データ投入（人手・PoC＝JSON）

1. **`agent/data/facts.json`** にヴィス直近2〜3期を投入（売上高/営業利益/経常利益/純利益/配当 ＋ セグメント別、実績/予想を区別）。各ファクトに `source_doc_label`/`source_page`/`source_url`/`source_quote`/`verified=true` を必ず付与（利益率はコード計算なので元値だけでよい）。**現状は空（ダミー禁止）。実際の短信/有報の検証済み数値のみ投入する**。
2. `eval/golden_set.vis.jsonl` の `gold_numbers`（現在空・`note`付き）を投入値と同時に埋める。

---

## D. ADK エージェント

```bash
# 依存は pyproject.toml に追加済み（google-adk 等）
uv sync

# agent/.env を用意（agent/.env.example をコピー。DB_PASSWORD は Secret から）
cp agent/.env.example agent/.env
#   GOOGLE_GENAI_USE_VERTEXAI=TRUE / GOOGLE_CLOUD_PROJECT / MODEL_NAME 等を確認

# ローカル起動（FastAPI SSE）
# PoCは FACTS_BACKEND=json（既定）。Cloud SQL不要＝DB_PASSWORDも不要。
# 本番のみ: export FACTS_BACKEND=cloudsql; export DB_PASSWORD="$(gcloud secrets versions access latest --secret=ir-faq-db-password)"
uv run uvicorn agent.server:app --port 8080

# Next.js から呼ぶ
export AGENT_URL=http://localhost:8080   # 本番は Cloud Run のURL
npm run dev

# デプロイ（PoC=Cloud Run、既存運用に合わせる）
uv run adk deploy cloud_run --region="$REGION" --service_account="$SA_EMAIL" agent
```

エージェントのツール（実装済み・`agent/`）:
- `get_financial_facts` → Cloud SQL `financial_facts`（YoY/利益率はコード計算）
- `search_disclosures` → 既存 Discovery Engine データストア
- `escalate_to_ir` → `escalations` テーブル

---

## E. 完了の確認（受け入れ条件）

```bash
python3 eval/eval_harness.py --self-test     # ハーネスのロジック確認（GCP不要）→ PASS
python3 eval/eval_harness.py                 # 実エージェントでCI関門（数値100%・コンプラ0件）
```

手動UX確認:
- 「営業利益はなぜ増えた？」→ 数値カード（出典 p.指定リンク）＋薄い語り（ストリーミング）
- 「営業利益とは？」→ 定義＋ヴィス実数
- 「買うべき？」「次の決算の数字は？」→ 親切に拒否
- 「競合のオフィス市況は？」→ エスカレーション＋「IR窓口へ」CTA

> 実環境で要確認: モデルID（`gemini-3-flash`）、Discovery Engine の `extractive_answers` フィールド名（`agent/tools.py` にコメント）。
