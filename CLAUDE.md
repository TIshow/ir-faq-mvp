# IR Agent — プロジェクト指示 / 引き継ぎガイド

> このファイルは AI / エンジニアが最初に読む「正」のドキュメント。
> 詳細は `docs/ARCHITECTURE.md`（設計）・`docs/DESIGN.md`（ブランド/デザインシステム）・`docs/HANDOFF.md`（現状・残課題・再開手順）。

## 1. これは何か
個人投資家が **選んだ上場企業の開示情報について自然言語で相談できる「IR Agent」**（B2B2C / 発行体に提供する想定）。
単なるFAQボットではなく、**開示済み情報のみを、出典付きで、対話的に深く言い換える**エージェント。
プロダクトブランドは **「Naruhodo IR（なるほどIR）」**（マーク=「！の芽」。IR Agent はリポジトリ/コード内部名。詳細 `docs/DESIGN.md`）。

**設計の背骨（最重要・崩さない）**
- **数値の正確性は決定論で担保する**。`fact_cards` の数値は層1からコードが取得・計算（YoY/利益率/構成比）し、**LLMは生成しない**。生成IR（分析散文）はLLMが書き数値にも言及するが、LLMには**コード計算済みの実数・比率だけ**を渡して暗算させない。散文の数値は隣のカード＋出典でクロスチェックできる。
- **生成IR（金融コパイロット型）**: 単なる数値列挙やFAQ逐語ではなく、層1（数値）＋層2（定性）を統合し「なぜ・何を意味するか・注目点」まで分析する回答を生成する。
- **二層グラウンディング**: 層1=構造化財務ファクト（決定論）／層2=開示文書の引用付き検索（定性）。
- **ガードレール**（コンプライアンス）: 投資助言・将来予測・未開示情報は答えない。開示済みの「会社予想」は『会社予想』と明示すれば可。不明・コーパス外は捏造せず IR 窓口へエスカレーション。
- **マルチテナント**: 対象企業はハードコードしない。リクエストごとに企業コンテキスト（ticker/name/datastore_id）を渡す。`companies.ts` が唯一の正。

## 2. アーキテクチャ（2層・2サービス）
```
ブラウザ
  └→ Cloud Run "ir-frontend"（Next.js 15 / TypeScript・UI）
        └ /api/chat/ が SSE プロキシ → AGENT_URL
             └→ Cloud Run "ir-agent"（Python / Google ADK・FastAPI・頭脳）
                  ├ 層1: get_financial_facts → 構造化ファクト（同梱JSON＋GCS 3,815社・#148）※YoY・利益率はコード計算
                  ├ 層2: search_disclosures → Discovery Engine（PDF＋FAQ）※2角度並列検索で背景/根拠も収集
                  ├ escalate_to_ir → 質問ログ（痛み②: IRインテリジェンス）
                  └ LLM: Vertex AI Gemini（本番 = gemini-2.5-flash。gemini-3 への移行は #91）
```
- フロントとエージェントが**別言語・別責務なので2サービス**（Next.js=画面、Python ADK=頭脳）。
- 回答契約 `AgentResponse = { answer_prose, fact_cards[], citations[], scope_status, scope_reason, suggestions[] }`（`src/lib/agent-types.ts` と Python 側で一致）。
- **回答生成＝Grounded Synthesis / 生成IR（既定 `ANSWER_MODE=synthesis`、`agent/synthesize.py`）**: ツール選択をLLMに委ねず retrieve（層1の全実値＋層2検索）を**決定論で常時実行**。2フェーズで生成し本文をトークン逐次ストリーミング: **CONTEXTUALIZE**（短期メモリ：会話履歴があればフォロー質問を自己完結クエリに書き換え）→ retrieve → **PLAN**（answerability判定＋カード指標選択・JSON）→ GROUND（数値カードはコードが接地）→ **WRITE**（生成IR本文を逐次）。LLMには「実数＋前年比・利益率・構成比（コード計算済み）」のデータシートを渡す。会話履歴はフロントが同梱しサーバはステートレス。WRITE は**読者レベル**（カジュアル=投資1年目でも読める翻訳/スタンダード=既定）で説明の翻訳度のみ調整し（専門性・数値は共通）、末尾に**💡注目ポイント**を添える。gemini-3 に移す際は**thinking最小化**で先頭トークンを短縮できる（#91）。旧来のADKツールループは `ANSWER_MODE=legacy` で残置（ロールバック用）。

## 3. リポジトリ構成
```
src/                      フロント（Next.js）
  app/page.tsx            トップ＝**銘柄を選ぶ入口**（対話はしない。将来ここを横断チャットの総合窓口に）
  app/c/[ticker]/page.tsx **銘柄URL**（例 /c/7561）＝その銘柄に固定したチャットUI＋公式Q&Aパネル。
                          AIに引用させるための実体（SSG・JSON-LD FAQPage・sr-only h1）。#113
  app/robots.ts / sitemap.ts / llms.txt/route.ts  AIクローラー向け導線（GPTBot等を明示的に許可）
  app/layout              画面
  app/api/chat/route.ts   エージェントへの SSE プロキシ（companies.ts から企業コンテキスト送信）
  app/api/doc/route.ts    出典PDFのプロキシ配信（非公開GCSをSA権限で中継・許可バケットのみ）
  app/api/ir/metrics/route.ts  IRダッシュボードの集計API（BQ集計・Firebase認証＋企業スコープ強制。5クエリ並列＝KPI/前期間比/IR要対応/話題/週次）
  app/api/ir/faq/route.ts      FAQ CRUD（Discovery Engine へ冪等upsert/一覧/削除。複利ループの投入口）
  app/api/ir/contact/route.ts  「IR窓口へ問い合わせる」記録（未認証）。押された質問のみ ir_requests へ＝IR要対応ワークリスト
  app/ir/page.tsx, app/ir/login/page.tsx  IR向け管理画面（KPI/話題トレンド/IR要対応/FAQ管理/週次チャート）＋ログイン（痛み②・ポップエディトリアル）
  lib/firebase.ts / firebase-admin.ts  Firebase Auth（マルチテナント。custom claims=company/admin。owner=全社アクセス）
  lib/gcp.ts              GCP_PROJECT_ID 等の集約（ハードコード排除）
  components/ChatInterface.tsx  チャットUI（SSE受信・ストリーミング表示・読者レベル・次質問サジェスト・吹き出しガーデン）
                          企業は props で受ける（銘柄URLがサーバー側で確定＝「未選択」状態は無い）
  components/QaPanel.tsx        公式Q&Aのサイドパネル（デスクトップ=右に二画面／スマホ=右から全面）。
                          **常時DOMに描画し開閉はCSSのみ**＝閉じていてもHTMLに答え全文が載る（#113の肝）
  components/CompanyEntry.tsx   トップの「続きから」＋旧 `?c=` を銘柄URLへ転送
  components/RememberCompany.tsx 銘柄URLを開いたことを記憶（描画なし）
  components/FactCard.tsx       評決カード/TrendCard（決定論チャート）/出典チップ/scope分岐/蔦レイアウト
  components/CompanyPicker.tsx  企業選択ピッカー（モノグラム＋ティッカー＋全社検索）
  components/CompanySearch.tsx  銘柄検索（トップ/ピッカー共用。上場3,829社・サーバー経由）
  components/TierBadge.tsx      「公式IR / 非公式IR」バッジ＝**見た目の唯一の正**（#145）
  app/api/companies/search/route.ts  企業検索API（レジストリ562KBをクライアントに配らない）
  components/Markdown.tsx       回答散文のMarkdown描画（マーカー強調・💡注目ポイント・CJK太字救済）
  components/BrandLogo.tsx      Naruhodo IR ロゴ（「！の芽」マーク＋ワードマーク）
  config/companies.ts     **顧客企業の契約情報**（datastoreId/isCustomer/publishOfficialQa/guidedQuestions）＝唯一の正
  data/listed-companies.json    非顧客3,825社のレジストリ（EDINETコード一覧から生成・562KB）
  lib/listed-companies.ts       レジストリのデータ層（**server-only**。検索・ticker/id 解決）
  lib/public-facts.ts     **公式Q&Aのデータ層**: 層1(data/facts/)から質問＋答え＋出典を決定論で組み立てる（LLM不使用）
  lib/last-company.ts     「前回みていた銘柄」の記憶（企業IDのみ。会話本文は保存しない）
  lib/site.ts             公開URL（sitemap/llms.txt/JSON-LD 用）
  lib/agent-types.ts      AgentResponse 等の型（契約）
  lib/agent-auth.ts       ir-agent呼び出しのIDトークン取得（#88・localhostはスキップ）
  lib/rate-limit.ts       /api/chat のIP単位レート制限（既定10回/分）
  app/globals.css         デザイントークン（色/影/カーソル）＋モーション＝デザインの実装上の正
public/brand/ , public/cursors/   ブランド素材（マーク/アイコン/カーソル。docs/DESIGN.md 参照）
agent/                    エージェント（Python / ADK）
  agent.py                本体。run_agent_stream が ANSWER_MODE で分岐（synthesis 既定 / legacy）＋AgentResponse 合成＋ストリーミング
  synthesize.py           **既定の回答生成（生成IR）**: retrieve→統合分析→接地。実値＋計算済み比率(前年比/利益率/構成比)のデータシートをLLMへ
  tools.py                ツール（get_financial_facts / search_disclosures / escalate_to_ir）＋ build_financial_facts（カード生成の純関数・synthesis と共用）
  prompt.py               legacy モードのシステムプロンプト（鉄則6項）。synthesis のプロンプトは synthesize.py 内
  scope.py                入口スコープ分類（助言/予測/未開示の短絡拒否）
  suggest.py              次質問サジェスト（A-lite: 利用可能データから決定論生成）
  analytics.py            Q&A永続ログ（痛み②: BigQuery interactions へ匿名記録。回答率/トレンド用。ANALYTICS_ENABLED で切替）
                          ※IR要対応一覧は「自動エスカレ」でなく、ユーザーがCTAを押した ir_requests のみ（/api/ir/contact）
  store.py / facts_store.py / db.py  層1ストア（json=PoC / cloudsql=本番 を FACTS_BACKEND で切替）
  server.py               FastAPI（/chat の SSE, /health）
  config.py               環境設定（.env 読込）
  data/facts/<ticker>.json  層1の**同梱**データ（**1社1ファイル**。人が確認した顧客企業。こちらが優先）。
                          非顧客3,815社は **GCS** から読む（`FACTS_GCS_BUCKET`・#148）。
                          同梱は検証済み実値のみ＝`verified:true`。GCSは `source_kind:"xbrl"`。捏造禁止
  .env.example            ローカル設定例
scripts/
  extract_facts.py        層1取り込み（GeminiでPDF→構造化ファクト草案。人手検証後 data/facts/<ticker>.json へ）
  edinet/client.py        EDINET API v2 クライアント（書類一覧・XBRL zip 取得。キャッシュ優先）
  edinet/parse.py         層1取り込み（有報XBRL→決定論抽出・**全社対応**。日本基準/IFRS・連結/単体・
                          セグメント自動検出。**有報1件から5期ぶん**取る（「主要な経営指標等の推移」）。
                          数値はタグから読むだけでLLMは通さない。詳細 docs/edinet-ingest.md）
  edinet/batch.py         一括取り込み＋カバレッジレポート（再開可能・重複は新しい提出が勝つ。
                          出力は data/facts-corpus/＝**配信用の agent/data/facts/ とは別**）
  edinet/codelist.py      企業マスター（EDINETコード一覧＝鍵不要。英語名/業種/決算月/法人番号。
                          上場3,829社。層1コーパスとの突合も。推測で埋めない）
  edinet/build_registry.py  非顧客レジストリ生成（src/data/listed-companies.json）
  sync_roadmap.py         **GitHub Issue → docs/ROADMAP.md** を生成（状態の正はIssue・§7）
eval/
  eval_harness.py         評価ハーネス（数値=決定論比較・コンプラ=ゼロ許容CI関門）
                          既定=1社(harux 24問) / `--all`=全3対象44問。**実LLMを呼ぶので課金される**
  golden_set.7561.jsonl(24問) / golden_set.vis.jsonl(12問) / golden_set.no-layer2.jsonl(8問)
                          ゴールデンセット。no-layer2 は**非顧客と同条件**（層2を外す・#151）
database/                 層1本番用 Cloud SQL スキーマ（financial_facts.sql 等。未接続=将来）
docs/                     ROADMAP.md（**生成物**）/ ARCHITECTURE.md / DESIGN.md / HANDOFF.md /
                          edinet-ingest.md / phase1-gcp-setup.md / investor-experience-quality.md
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

# 評価ハーネスのロジック確認（GCP不要・無料）
python3 eval/eval_harness.py --self-test

# eval（実LLMを呼ぶ＝課金される）
uv run python3 eval/eval_harness.py            # 反復中はこれ。旗艦ハークスレイ24問
uv run python3 eval/eval_harness.py --all      # **PRを出す前に1回だけ**。全3対象44問
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
- **モデルは交換可能に保つ**。`MODEL_NAME`（env / config）で切替。
  **本番で動いているのは `gemini-2.5-flash`**（`cloudbuild.agent.yaml` と Cloud Run の実値で確認済み・2026-08-06）。
  `gemini-3-flash-preview` は **global 提供**（`GCP_VERTEX_AI_LOCATION=global`。us-central1 には無く、素の `gemini-3-flash` は404）で、
  移行は #91 で扱う。切替は必ず eval関門（数値100%/コンプラ0）で検証すること。
- コミットは小さくPRで。main 直 push しない（PR→squash merge 運用）。
- **PR作成後はマージせず一旦停止し、ユーザーのレビュー/承認を待ってからマージする**（merge の手前で必ず確認を取る）。
- **eval は反復中1社・PR前に1回だけ全社**。`eval_harness.py` は `run_agent` を直接呼ぶので
  Cloud Run を通らず**ローカル実行でも Vertex AI に課金される**（1問=LLM3回）。
  実測: 本番の利用者は1日3〜6件なのに、開発中のevalで1日517回叩いていた日がある
  （8/3・¥276＝44問×3回の全社周回を4周ぶん）。既定を1社にしてあるのはこのため。
  **関門そのものは緩めない**——数値100%/コンプラ0は維持し、頻度だけ落とす。
  CI が回すのは `--self-test`（LLM不使用）だけなので、**実evalは人が回す責任**。
- 秘密情報はコミットしない（`.env*` は gitignore、`agent/.env.example` のみ追跡）。

## 7. タスク管理（2026-08-06 導入）

**状態の正は GitHub Issue。** Markdownに状態を書き写すと必ず腐る——実際 epic #130 の
手書きチェックボックスは #131〜#136 が完了しても未チェックのまま放置されていた。

| 置き場 | 役割 |
|---|---|
| **GitHub Issue** | 唯一の正。open/closed が状態そのもの |
| **サブIssue** | epic の進捗。GitHubが自動集計する（手書きチェックボックスは使わない） |
| **ラベル3軸** | `type:` 何をするか / `area:` どこを触るか / `P0-now` `P1-next` `P2-later` いつやるか |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | **生成物**。リポジトリを読むだけで全体像が掴めるようにするためのビュー |

```bash
uv run python scripts/sync_roadmap.py           # Issueの変更後に再生成
uv run python scripts/sync_roadmap.py --check   # ズレているか見るだけ
```

**CIでは検査しない**（#167）。Issueを閉じると open の表から行が消えるので、
`Closes #N` 付きのPRをマージするたび次のPRが無関係に落ちてしまう。
生成日を本文に持たせてあるので、古さは見れば分かる。

運用の約束:

- **タスクは必ず Issue を立ててから着手する。** PR本文に `Closes #N` を書けば自動で閉じる
  （`Refs #N` だと閉じない。#145 がこれで完了後も open のまま残っていた）
- 着手したら `P0-now` を付ける。終わったら Issue を閉じる（ROADMAPは触らない・生成物なので）
- epic は**サブIssue**で子を持つ。本文にチェックボックスを書かない
- 優先度ラベルが無い Issue は ROADMAP に「ラベルが無い」として名指しで出る（黙って消さない）

## 8. 現状サマリ（2026-08-06）

**本番**: `ir-frontend-00045` / `ir-agent-00034`（us-central1）

- ✅ **全上場3,829社が検索から到達でき、EDINETの数値に出典つきで答える**（#130 epic の主要部分が完了）。
  層1コーパス＝**3,815社 / 200,767ファクト / 5期ぶん**（2021FY〜2026FY）を有報XBRLから決定論抽出。
  ハークスレイの人手検証データと突合して**一致23 / 不一致0**（ユーザーが四季報でも照合済み）。
  配信は**GCS**（`gs://hallowed-trail-462613-v1-facts/facts/<ticker>.json`・#148）＝イメージに焼かず、
  同梱（人手検証済みの顧客）を優先し、無いときだけGCSを引く。
- ✅ **顧客 / 非顧客の階層**（#145）: 顧客＝層1＋層2＋IR窓口への取り次ぎ＝「公式IR」。
  非顧客＝層1のみ＝「非公式IR」。UIのバッジで区別し、**層2が無いとき原因を創作しない**（#151・専用ゴールデン8問で担保）。
  階層はフロントから**明示的に送る**（`datastoreId` から再導出しない＝判定を1箇所に保つ）。
- ✅ **到達経路**（#154 / PR #158）: トップと銘柄ピッカーの検索で上場3,829社を引ける。
  レジストリ562KBはサーバー専用（`server-only`）で、検索は `/api/companies/search` 経由。
- ✅ **生成IR（既定 `ANSWER_MODE=synthesis`）**: 層1（コード計算済みデータシート）＋層2（2角度並列検索）を統合。
  数値はLLM非経由＝決定論。読者レベル2段階、本文ストリーミング、💡注目ポイント、カード上限8枚。
- ✅ **痛み②の堀**: escalation→FAQ複利ループ＋IRダッシュボード（KPI4枚/話題トレンド/IR要対応/週次/FAQ管理・Firebase認証）。
- ✅ **#113 銘柄URL＝AIに引用させる実体**: `/c/<ticker>` は銘柄固定のチャットUI＋公式Q&Aパネル
  （**常時DOM・開閉はCSSのみ**＝JS非実行のクローラーが答え全文を読める）。JSON-LD/robots/sitemap/llms.txt。
  **公開ゲート `publishOfficialQa`（既定false）**＝現在の公開はハークスレイ(7561)のみ。
- ✅ **セキュリティ #88**: ir-agent は非公開（invoker=フロントSAのみ・IDトークン・レート制限10回/分）。
  `cloudbuild.agent.yaml` の `--allow-unauthenticated` を `--no-allow-unauthenticated` に修正済み
  （**デプロイのたびに allUsers が戻る**状態だった）。
- ✅ **信頼・プライバシー**: 誹謗中傷の入口ガード。会話の**本文はどこにも保存しない**（メタデータのみ）。
- ✅ **UIX/ブランド（Naruhodo IR）**: クリーム×インク×ポップの「ポップエディトリアル」（`docs/DESIGN.md` が正）。
  評決カード＋決定論チャート・マーカー強調散文・蔦の成長演出・芽吹くカーソル・「！の芽」ロゴ。

⚠️ **既知の穴**

- **一部の企業は連結売上をXBRLにタグ付けしていない**（#146 の残り・43社）。**無いものは出せない**。
  実例: **トヨタ**は「Revenue」を含む要素が0件（営業費用・売上原価・営業利益はあるのに売上収益だけ無い）。
  `NetSales` は5期あるが全て単体なので採らない。#162 の「答えられる指標の案内」でカバーする。
  カバレッジ: ordinary_profit 100% / net_income 99.9% / eps 99.9% / **revenue 99.3%** /
  operating_profit 97.0% / roe 90.2% / **gross_profit 84.8%** / dividend 78.3%
- 層2（開示文書の検索）は**顧客4社ぶんだけ**。非顧客3,825社は数値のみ。
- モデルは `gemini-2.5-flash`。gemini-3 への移行は #91。
- 残りは [`docs/ROADMAP.md`](docs/ROADMAP.md) と GitHub Issue を見ること。戦略は **#77**。

```
GitHub: https://github.com/TIshow/ir-faq-mvp （PR #1〜#159 マージ済）
GCP project: hallowed-trail-462613-v1 / region us-central1（Vertexはglobal）
請求: eval はローカル実行でも Vertex AI に課金される（§6）。本番の利用者は1日3〜6件。
```
