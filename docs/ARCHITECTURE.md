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
[ir-agent]  Cloud Run / Python + FastAPI（既定: Grounded Synthesis / 生成IR）
   │  run_agent_stream(query, company, history, audience)  ※history=短期メモリ / audience=読者レベル（翻訳度のみ）
   ├─ [1] 入口スコープ分類 scope.classify_scope（助言/予測/未開示を短絡拒否）
   ├─ [2] config.ANSWER_MODE で分岐（既定 'synthesis'）
   │
   │  ── synthesis（既定・agent/synthesize.py）= 生成IR（本文ストリーミング）─────
   │   ├─ CONTEXTUALIZE（短期メモリ）: history があれば、フォロー質問（「なんで？」等）を
   │   │     会話履歴で**自己完結クエリに書き換え**（condense question）。無ければ素通り＝従来同一
   │   ├─ RETRIEVE（決定論・常に両層）:
   │   │     - 層1 全実値＋前年比/利益率/構成比を**コード計算**したデータシート（_facts_context）
   │   │     - 層2 search_disclosures を**2角度並列**（質問そのもの＋「背景・要因・会社の説明」）
   │   │       →dedupe・上限12。過去資料/想定問答の"根拠・背景"も補足材料として拾う
   │   ├─ PLAN（LLM・構造化JSON＝eval決定論性を守る）:
   │   │     {can_answer, relevant_metrics, used_citations, escalate_reason}
   │   ├─ GROUND（決定論）: relevant_metrics→build_financial_facts でカードを接地。
   │   │     can_answer=false / 接地ゼロ → 正直にエスカレ（ここで終了）
   │   └─ WRITE（LLM・プレーンテキスト・ストリーム）: 生成IR本文をトークン逐次生成
   │         （会社の説明を数値とセットで織り込む＋末尾に「💡注目ポイント」／
   │          読者レベル audience で"翻訳度"だけ調整・専門性は共通）
   │
   │  ── legacy（ANSWER_MODE=legacy・ロールバック用）= ADKツールループ ──
   │   └─ ADK Runner（LLM がツール選択）: get_financial_facts / search_disclosures / escalate_to_ir
   │       → _compose で合成
   ▼
   SSE で {prose_delta...（本文を逐次）} → {final: AgentResponse}
```

> **生成IRの肝**: 数値カード（fact_cards）はどちらのモードも**コードが層1から生成**（LLM非経由＝決定論）。
> synthesis では LLM に「コード計算済みの実数・比率」を渡して分析散文（生成IR）を書かせ、暗算させない。
> 散文の数値は隣のカード＋出典でクロスチェックできる。詳細は「回答生成モード」節。

## 二層グラウンディング（最重要原則）
| 層 | 役割 | ソース | 実装 | 鉄則 |
|---|---|---|---|---|
| **層1** | 数値（営業利益・売上・配当・セグメント等） | 構造化財務ファクト | `agent/store.py`→`facts_store`(JSON, PoC) / `db`(Cloud SQL, 本番) | **数値はLLMを通さず**ツール戻り値→`fact_cards`としてUI直送。YoY/利益率はコード計算 |
| **層2** | 定性（なぜ/背景/方針）、FAQ | 開示文書（PDF）＋ IR想定問答(faq.csv) | `agent/tools.py::search_disclosures` → Discovery Engine | 必ず引用(citations)付き。FAQは構造化(structData)から、PDFはsnippetから抽出 |

## 回答生成モード（ANSWER_MODE）
`config.ANSWER_MODE` で切替（既定 `synthesis`）。回答契約・カードの決定論性はどちらも同じ。

### synthesis（既定）= Grounded Synthesis / 生成IR（`agent/synthesize.py`）
狙い: ①ツール選択の脆さを排除（retrieve は常に全部・決定論）②横断質問の統合分析（生成IR）③answerability 判定で正直にエスカレ ④数値の正確性維持 ⑤本文ストリーミングで体感速度。
回答は**2フェーズ**で生成し、本文をトークン逐次で流す（`synthesize_stream`）:
- **CONTEXTUALIZE（短期メモリ・`_contextualize`）**: `history`（直近の会話）があれば、フォロー質問（「なんで？」「前期は？」）を会話履歴で**自己完結クエリに書き換え**（condense question）てから retrieve/plan へ。履歴が無ければ LLM を呼ばず素通り＝**eval は従来と完全に同一**。履歴は質問の解釈のみに使い、数値の根拠にはしない（決定論維持）。
- **RETRIEVE**: `_facts_context(ticker)` が層1の全実値に加え**前年比・営業利益率・セグメント構成比をコードで計算**した「分析用データシート」を作る（LLMに暗算させない）。層2は `search_disclosures` を**2角度で並列検索**（1本目=質問そのもの／2本目=「背景・要因・会社の説明」angle）＝Multi-Query Retrieval。結果は dedupe＋上限12（`_MAX_PASSAGES`）。並列実行のためレイテンシ増なし。最新決算を聞かれても**過去の説明資料・IR想定問答に根拠/背景があれば補足材料として同梱**できる。選別は下流の PLAN(answerability) が担う。
- **PLAN（answerability・JSONモード）**: LLM が `{can_answer, relevant_metrics, used_citations, escalate_reason}` を返す（構造化出力＝eval決定論性を守る）。`can_answer=false` ならここで即エスカレ（本文生成なし＝速い）。プロンプトは「FAQ逐語禁止」「新たな割り算をしない＝計算済み値を使う」。最優先規則: **FAQ/開示抜粋が質問に直接答えるなら、構造化数値に無い指標(例ROE)でも answered**。応答のパースは `_parse_plan_json`（`raw_decode` で先頭の完全なJSONのみ取り出す）＝gemini-3 が json_mode でも稀にJSON後へ余分テキストを付けて `Extra data` で落ちる揺らぎへの恒久対処（#105）。
- **GROUND**: `relevant_metrics` から `build_financial_facts` がカードの数値を**コードで**埋める（過多は `_reduce_cards` で抑制。派生指標＝全社/セグメント利益率・売上構成比・利益寄与度もコード計算でカード化可）。カードも引用も無い（接地ゼロ）なら正直にエスカレ。
- **話題分類（PLAN相乗り）**: PLAN の出力に `topic` を含め、質問を固定タクソノミー（agent/analytics.py の TOPICS・14分類）へ分類（追加LLMコールなし）。`topic` は AgentResponse 契約外の内部フィールドで、agent.py が pop して分析記録にのみ使う。
- **WRITE（本文・プレーンテキスト・ストリーム）**: `generate_content_stream` で生成IR本文をトークン逐次生成。数値は提供データシートの範囲のみ（カード＋出典でクロスチェック）。**開示抜粋に会社自身の説明があれば数値とセットで織り込み**、本文末尾に「#### 💡 注目ポイント」（開示事実の範囲の気づき1〜3点・**意見/推奨/予測は禁止**・材料が無ければ省略）。
- **読者レベル（audience）**: `beginner`/`intermediate`(既定)/`advanced` を WRITE プロンプトに注入し**説明の"翻訳度"のみ調整**（初心者=用語に一言注釈・短文／上級者=注釈なし高密度）。**分析の中身・数値・専門性は共通**＝eval不変。有効値の正は `AUDIENCE_STYLES`、境界で `normalize_audience` が丸める。
- **速度**: 全LLM呼び出しを `_generate`/`_generate_stream` に集約し**thinkingを最小化**（`thinking_level=low`。gemini-3 の動的thinkingが先頭トークンを遅らせるが、入力はコード計算済みで深い推論不要のため。SDK/モデル差異に `thinking_budget=0`→指定なしへ多段フォールバック＋プロセス内キャッシュ）。先頭トークン ≒半減（24→12s）。品質は eval 関門で担保。
- カードの抜粋番号 `[0]` 等は内部参照用（`used_citations` 選択）。本文に漏れたら `_strip_refs` で除去。

### legacy（`ANSWER_MODE=legacy`）= ADKツールループ（ロールバック用）
企業別 Agent を構築し、LLM が `get_financial_facts`/`search_disclosures`/`escalate_to_ir` を逐次選択。`_compose` で合成。ツール選択ミス補償のため「escalate前に search_disclosures フォールバック」を持つ。

## 回答契約 AgentResponse
`src/lib/agent-types.ts`（TS）と `agent/`（Python合成）で一致させる:
```ts
AgentResponse = {
  answer_prose: string          // 生成IR（分析散文）。synthesis では数値・表に言及可（カード＋出典で裏取り）
  fact_cards: FactCard[]        // 層1由来の数値（出典付き・コード生成＝LLM非経由）。出典なしカードは描画しない
  citations: Citation[]         // 層2由来の出典（doc/page/url/quote）
  scope_status: 'answered' | 'refused' | 'escalated'
  scope_reason?: 'advice' | 'prediction' | 'undisclosed' | 'inappropriate' | 'out_of_corpus' | 'unknown'
  suggestions: string[]         // 次質問サジェスト（A-lite: 利用可能データから決定論生成。拒否時も行き止まりにしない）
}
FactCard = { metric, metricKey, period, value, valueNumeric, unit, yoy?, consolidated, basis:'actual'|'forecast', source: Citation }
```
> リクエスト側（/api/chat body）: `message, companyId, sessionId, history[], audience`。`audience` と `history` は synthesis のみ使用（レスポンス契約 AgentResponse には含めない）。

## フロント UIX（Naruhodo IR — クリーム×インク×ポップ）
> ブランド・トークン・演出ルールの詳細は **`DESIGN.md`**（実装上の正は `globals.css` の `@theme`/`:root`）。ここではアーキテクチャに関わる要点のみ。
- **読者レベル切替**: コンテキストバーの2択セグメント（カジュアル/スタンダード）。旧3段階(beginner/intermediate/advanced)の保存値・リクエスト値は casual/standard へ後方互換マッピング（フロントは初回ロードで新値に書き戻す自己清掃型）。選択は `localStorage('ir-audience')` に永続し `/api/chat` の `audience` として送る（説明の翻訳度のみ変わる）。
- **評決カード＋決定論チャート**（`FactCard.tsx`）: `planCards()` が fact_cards を「先頭カードと同一 metricKey が複数期あれば TrendCard（大きな数字＋YoYピル＋棒グラフ。予想は点線）に集約、残りはステータスカードのグリッド」に並べ替える。**値の加工・生成は一切しない＝チャートも決定論**（データが無ければチャートは出ない）。
- **蔦レイアウト**（`FactCard.tsx` VineNode）: 回答の各セクション（数値/散文/出典/CTA/サジェスト）を茎＋枝＋芽の節で接続し、`VINE_STEP_MS`(160ms) の階段で「育つ」演出。末端の節は双葉。純CSS（transform/opacity・一度だけ再生）でコンテンツ不変。
- **散文のエディトリアル描画**（`Markdown.tsx`）: 太字→黄マーカー（`.mk`）、💡注目ポイント（h4）→マーカー見出し。CommonMark仕様で日本語約物隣接の `**「…」**` が強調にならない問題は `remarkCjkStrong`（パース後ASTの救済プラグイン・生HTML不使用＝XSS安全）で解決。
- **モーション原則**: transform/opacity のみ・無限ループなし・`prefers-reduced-motion` で全静止（globals.css で一括管理）。ブランドカーソル（`--cursor-*` トークン・SVG→PNG→OS標準フォールバック）も同様に実用性優先の例外（入力=I-beam・無効=not-allowed）を持つ。`lang=ja`。

## マルチテナント（企業切替）
- フロント `companies.ts` が唯一の正（id/name/ticker/datastoreId/isActive）。
- route.ts → server.py へ `companyTicker / companyName / datastoreId` を送る。
- `run_agent_stream(query, company)` が:
  - 企業名＋利用可能データを差し込んだ**企業別プロンプト**で Agent を構築
  - **セッション状態 `state["company"]`** に企業を seed（session_id に ticker を含め混在防止）
- ツールは `tool_context.state["company"]` から ticker / datastore_id を取得（ハードコードなし）。
- データが無い企業は捏造せず「データなし」＋エスカレーション（クロス企業漏れなし）。

## ガードレール（多層防御）
1. **入口** `scope.py`: 明白な 助言/予測/未開示/**不適切（誹謗中傷・脅迫）** を正規表現で短絡拒否（LLM呼ばず）。「会社予想」は通す（両モード共通）。不適切は refused＝CTA非表示＝IR要対応に転送されず、分析記録もマスク・集計除外（IR室を守る）。
2. **生成** プロンプト鉄則: 開示事実のみ・**新たな数値計算をしない（計算済み値を使う）**・出典必須・助言/予測しない・未開示言及せず・不明はIR案内。synthesis は `synthesize.py` 内、legacy は `prompt.py`（鉄則6項）。
3. **出口/接地** 数値カードはコードが生成（LLM非経由）。synthesis: can_answer=false / 接地ゼロ → エスカレ。legacy: `agent.py::_compose` で出典なしカード除去・scope_status 確定。
4. **数値の最終防衛**: 散文の数値はLLMが書くが、その値は「コード計算済みデータシート」由来であり、隣の決定論カード＋出典でクロスチェックできる（重い出口ゲートは置かない設計判断）。

## エスカレーションと「IR要対応」（痛み②の堀）
2種類を**役割で分離**している（混同しない）:
- **自動エスカレ** `scope_status='escalated'`: エージェントが答えられないと判断した状態。**CTA「IR窓口へ問い合わせる」の表示**と、`interactions` への記録（回答率/トレンド分析）に使う。**ダッシュボードの要対応一覧には入れない**（自動判定は曖昧で肥大化するため）。
- **IR要対応** `ir_analytics.ir_requests`: **投資家がCTAを押したものだけ**。`/api/ir/contact`（未認証・企業は companies.ts で検証）が記録し、`/ir` の「IR要対応」一覧＝IRが実際に対応するワークリスト。一覧は**同一質問をグループ化（×N）**し、`/api/ir/resolve`（要認証）が `ir_analytics.ir_resolved` に解決マーカーを入れると一覧から消える（BQはstreaming buffer中の行をDELETEできないため、削除でなくマーカー方式）。
- **分析記録は本文レス**（`interactions`＝ts/企業/scope/カード・引用数/話題のみ＝メタデータ。本文は保存しない）。記録は **fire-and-forget**（別スレッド）で final 応答を BQ 往復で待たせない（best-effort は不変）。原文が残るのはCTA同意済みの `ir_requests` だけ。ダッシュボードの「話題トレンド」は `GROUP BY topic` の純SQL（原文非表示・表記ゆれは話題単位で自然合算）。
- legacy の `escalate_to_ir`→`store.insert_escalation`（Cloud SQL escalations / facts_store の escalations.jsonl）は**現行ダッシュボードからは未参照**（ir_requests に置換済み）。legacy モードのロールバック用に存置。

## 評価（eval/eval_harness.py）
- **数値はコードで決定論比較**（`numbers_match`）、定性は LLM-judge（フック）。
- CI関門（ゼロ許容）: 数値一致率100% ＋ 助言/未開示の誤回答0件。
- 品質eval しきい値: depth/educational/tone/followup（`docs/investor-experience-quality.md`）。
- `--self-test` でハーネスのロジックを GCP 無しで検証。

## デプロイ構成
| サービス | 種別 | ビルド/デプロイ | 公開 |
|---|---|---|---|
| ir-frontend | Cloud Run (Next.js) | `Dockerfile` / `cloudbuild.yaml` / `gcloud run deploy --source` | allUsers（公開UI）＋ /api/chat にIP単位レート制限（`CHAT_RATE_LIMIT_PER_MIN` 既定10/分） |
| ir-agent | Cloud Run (Python) | `Dockerfile.agent` / `cloudbuild.agent.yaml` | **非公開（#88完了）**: invoker=フロントSAのみ。フロントが `lib/agent-auth.ts` のIDトークンで呼ぶ（直叩き403・localhostはスキップ） |
- `next.config.mjs`（**.tsだとCloud Run実行時にtypescript依存で503**になるため .mjs）。
- フロント↔エージェントは `AGENT_URL` env で接続。
- エージェントの Vertex/Discovery Engine 認証は Cloud Run ランタイムSA（デフォルトCompute SAが既に権限保有）。

## 既知の設計上の注意（ハマりどころ）
- Discovery Engine データストアが **chunking config** のため、検索リクエストに `extractive_content_spec` を入れると **400**。**snippet_spec のみ**にする（`tools.py` 済）。
- FAQ(faq.csv)は **structData{question,answer}** として取り込まれる。`search_disclosures` は structData を最優先で読む。
- ローカルで discoveryengine API を叩くには ADC に quota project 設定が必要（`gcloud auth application-default set-quota-project`）。Cloud Run 上はランタイムSAなので不要。
- モデルは `gemini-3-flash-preview`（**global 提供**。`us-central1` には無い）。素の `gemini-3-flash` というIDは存在せず404。ロールバックは `MODEL_NAME=gemini-2.5-flash`（globalでも動作確認済み）。切替は必ず eval関門で検証。
