# ロードマップ

> **このファイルは生成物です。直接編集しないでください。**
> タスクの状態の正は GitHub Issue です。ここはリポジトリを読むだけで全体像を掴むためのビュー。
> 再生成: `uv run python scripts/sync_roadmap.py`

生成: 2026-08-06 / open 22件

分類は3軸のラベルで付けています（`type:` 何をするか / `area:` どこを触るか / `P0〜P2` いつやるか）。

## いま／次にやる（`P0-now`）

着手中、または次に手を付けるもの

| Issue | 種類 | 領域 | 内容 |
|---|---|---|---|
| [#146](https://github.com/TIshow/ir-faq-mvp/issues/146) | fix | 層1（数値） | 層1の指標マップを広げる（revenue 93.6% / gross_profit 未対応 / 業種別の売上要素） |
| [#130](https://github.com/TIshow/ir-faq-mvp/issues/130) | epic | 層1（数値） | epic: EDINET APIで層1（数値）を全上場企業ぶん取り込む |
| [#97](https://github.com/TIshow/ir-faq-mvp/issues/97) | strategy | 事業 | [事業] ハークスレイで実トラフィックを回し FAQ複利ループを1周させる（Tier A・堀の起動） |

## 近いうちに（`P1-next`）

着手条件が揃えばすぐ動かせるもの

| Issue | 種類 | 領域 | 内容 |
|---|---|---|---|
| [#144](https://github.com/TIshow/ir-faq-mvp/issues/144) | feat | エージェント | 同業比較を「他社=数値のみ／自社=数値+説明」の非対称で成立させる（#87の手前・顧客1社で動く版） |
| [#137](https://github.com/TIshow/ir-faq-mvp/issues/137) | feat | 層1（数値） | feat(edinet): fiscalYearEndMonth を XBRL から自動生成する |
| [#107](https://github.com/TIshow/ir-faq-mvp/issues/107) | chore | 層2（引用付き検索） | [品質/RAG] 層2の精度: 評価セット(50〜100問)を作り、文書取り込み方式を比較（raw PDF / digital / layout parser / 手動Markdown / XBRL併用） |
| [#98](https://github.com/TIshow/ir-faq-mvp/issues/98) | feat | 層1（数値） | [機能/データ] 層1の縦深化: 多年度＋BS/CF/資本/負債/税率をXBRLから投入（ROE/ROIC・推移の解禁）= B1 |
| [#92](https://github.com/TIshow/ir-faq-mvp/issues/92) | chore | インフラ | [運用] 小規模ハードニング3件: 層1データのコンテナ外出し / CI自動デプロイ / analytics の非同期化 |
| [#89](https://github.com/TIshow/ir-faq-mvp/issues/89) | chore | インフラ | [インフラ] BigQuery データセットを東京リージョン(asia-northeast1)へ（データが空の今が唯一の低コスト機会） |
| [#77](https://github.com/TIshow/ir-faq-mvp/issues/77) | strategy | 事業 | 戦略: Bloomberg系コパイロットとして足りないもの／moat の再導出と残タスク |

## あとで（`P2-later`）

やる価値はあるが今ではないもの

| Issue | 種類 | 領域 | 内容 |
|---|---|---|---|
| [#116](https://github.com/TIshow/ir-faq-mvp/issues/116) | feat | 層2（引用付き検索） | [機能/複利ループ] FAQ候補を自動生成し、IRが承認して公式化するフロー（想定問答ゼロからの立ち上げ） |
| [#114](https://github.com/TIshow/ir-faq-mvp/issues/114) | feat | 事業 | [配信/製品形態] 発行体IRサイトへの埋め込みウィジェット（唯一自前で守れる導線） |
| [#91](https://github.com/TIshow/ir-faq-mvp/issues/91) | chore | インフラ | [運用] LLMモデル世代の管理: gemini-3 開放の定期確認と eval 関門つき移行演習 |
| [#90](https://github.com/TIshow/ir-faq-mvp/issues/90) | chore | インフラ | [インフラ/セキュリティ] Cloud Run をサービス別サービスアカウント＋最小権限に分離 |
| [#87](https://github.com/TIshow/ir-faq-mvp/issues/87) | feat | エージェント | 公式回答のフェデレーション：複数発行体エージェントを横断照会できる投資家側UI |
| [#86](https://github.com/TIshow/ir-faq-mvp/issues/86) | feat | エージェント | 「一問一答の自動販売機」から「続く関係」へ：話題フォローと開示更新の接地済み通知 |
| [#85](https://github.com/TIshow/ir-faq-mvp/issues/85) | feat | エージェント | 公式IRエージェントを MCP/API エンドポイント化し、AIアシスタントから直接照会可能にする |
| [#67](https://github.com/TIshow/ir-faq-mvp/issues/67) | feat | 層1（数値） | 派生指標のカード化（成長率/CAGR/寄与度）＋ ROIC/ROE等のデータ拡張 |
| [#47](https://github.com/TIshow/ir-faq-mvp/issues/47) | chore | インフラ | コスト: Artifact Registry 自動クリーンアップポリシー（イメージ蓄積の防止） |
| [#46](https://github.com/TIshow/ir-faq-mvp/issues/46) | epic | 事業 | Tier1: IRインテリジェンス（質問ログ基盤→ダッシュボード→FAQ複利ループ） |
| [#42](https://github.com/TIshow/ir-faq-mvp/issues/42) | feat | エージェント | 次の質問サジェスト: LLM生成版（A）— A-liteからの昇格 |
| [#3](https://github.com/TIshow/ir-faq-mvp/issues/3) | chore | インフラ | 将来: フロントを GCP（Firebase App Hosting / Cloud Run）へ移行し全スタックをGCPに集約 |

## 最近終わったもの

| Issue | 完了日 | 内容 |
|---|---|---|
| [#162](https://github.com/TIshow/ir-faq-mvp/issues/162) | 2026-08-06 | fix(ui): 答えられないときの伝え方（同じ文が2回出る／聞かれていない「背景・要因」の話をする） |
| [#161](https://github.com/TIshow/ir-faq-mvp/issues/161) | 2026-08-06 | fix(agent): 答えられなかった直前の質問が、次の質問を答えられなくする（短期メモリの汚染） |
| [#154](https://github.com/TIshow/ir-faq-mvp/issues/154) | 2026-08-05 | feat(edinet): 企業マスターをEDINETコード一覧から作る（3,815社ぶんの nameEn/業種/決算月） |
| [#151](https://github.com/TIshow/ir-faq-mvp/issues/151) | 2026-08-05 | fix(agent): 開示抜粋が無いとき、LLMが原因を創作する（出典ゼロで因果を書く） |
| [#149](https://github.com/TIshow/ir-faq-mvp/issues/149) | 2026-08-05 | feat(edinet): 有報1件から5期ぶん抽出する（「主要な経営指標等の推移」） |
| [#148](https://github.com/TIshow/ir-faq-mvp/issues/148) | 2026-08-05 | 層1の取り込みをGCPで自動運用する（Cloud Run Job＋GCS・データ更新にデプロイを不要にする） |
| [#145](https://github.com/TIshow/ir-faq-mvp/issues/145) | 2026-08-06 | 非顧客企業もEDINETの数値だけで回答できるようにする（投資家側のコールドスタート解消・#77の方針変更） |
| [#136](https://github.com/TIshow/ir-faq-mvp/issues/136) | 2026-08-05 | feat(edinet): 1年分バッチ ＋ カバレッジレポート |
| [#135](https://github.com/TIshow/ir-faq-mvp/issues/135) | 2026-08-04 | design(edinet): 層1の保存先を決める（facts.json 単一ファイルが限界を迎える） |
| [#134](https://github.com/TIshow/ir-faq-mvp/issues/134) | 2026-08-04 | design(edinet): セグメント slug の命名を決める（自動生成と既存の手作業が食い違う） |
| [#133](https://github.com/TIshow/ir-faq-mvp/issues/133) | 2026-08-04 | fix(edinet): 単体/連結を判定する（いま無条件に「連結」と記録している） |
| [#132](https://github.com/TIshow/ir-faq-mvp/issues/132) | 2026-08-04 | fix(edinet): IFRS採用企業を実物で検証する（要素名が未検証の当て推量） |
| [#131](https://github.com/TIshow/ir-faq-mvp/issues/131) | 2026-08-04 | fix(edinet): 抽出失敗社を分類する（「0件」で片付けない） |
| [#126](https://github.com/TIshow/ir-faq-mvp/issues/126) | 2026-08-03 | refactor(uix): 「インク縁の白ピル」を共有定数に括り出す（3箇所で実装が分岐している） |
| [#118](https://github.com/TIshow/ir-faq-mvp/issues/118) | 2026-08-03 | fix(security): SSE のエラー応答から例外メッセージを外す（py/stack-trace-exposure） |
