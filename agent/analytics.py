"""Q&Aインタラクションの永続ログ（痛み②: IRインテリジェンスの土台）。

全Q&Aの**メタデータのみ**を BigQuery に匿名で記録する（回答率/エスカレーション/話題トレンド用）。
個人識別子も**質問の本文も持たない**（プライバシー・バイ・デザイン。本文が保存されるのは
ユーザーが「IR窓口へ問い合わせる」で明示同意した ir_requests のみ）。

原則:
- **best-effort**：記録失敗はチャット応答を壊さない（例外は握り潰してログのみ）。
- **ゲート**：config.ANALYTICS_ENABLED が False なら何もしない（ローカル/評価でテーブルを汚さない）。
- **遅延import**：無効時に google-cloud-bigquery を読み込まない。
- 書込は streaming insert（低volumeでほぼ無料）。テーブルは ts 日付パーティション＋company_ticker クラスタ。
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from . import config

_log = logging.getLogger("ir-agent.analytics")
_client = None  # 遅延生成した BigQuery クライアントのキャッシュ

# --- 話題タクソノミー（v1・全社共通＝マルチテナント）--------------------------
# ダッシュボードの「話題トレンド」用。質問の原文は IR に見せず、話題×件数だけ集計する
# （プライバシー保護）。LLM は生成せず**この中から選ぶだけ**＝ラベルが揺れず GROUP BY topic
# が決定論になる（relevant_metrics で指標キーを選ばせるのと同じパターン）。
TOPICS: list[str] = [
    "業績・決算（全社）",
    "セグメント・事業別",
    "会社予想・ガイダンス",
    "配当・株主還元",
    "株主優待",
    "財務体質（資産・負債・CF）",
    "資本効率（ROE・ROIC）",
    "成長戦略・中計",
    "事業内容・ビジネスモデル",
    "市場環境・競合",
    "ESG・サステナビリティ",
    "ガバナンス・経営体制",
    "用語・使い方",
    "その他",
]
TOPIC_FALLBACK = "その他"

# 拒否（助言/予測/未開示/不適切）は LLM を通らないため scope_reason から決定論マッピング
# （LLM の選択肢には含めない）。
_REFUSAL_TOPICS: dict[str, str] = {
    "advice": "対象外（助言・予測・未開示）",
    "prediction": "対象外（助言・予測・未開示）",
    "undisclosed": "対象外（助言・予測・未開示）",
    "inappropriate": "不適切",
}


def topic_for_refusal(scope_reason: str | None) -> str:
    """入口拒否の話題ラベル（決定論・LLM不使用）。"""
    return _REFUSAL_TOPICS.get(scope_reason or "", TOPIC_FALLBACK)


def normalize_topic(topic: str | None) -> str:
    """LLM が返した話題をタクソノミーに正規化（未知ラベルは「その他」に落とす）。"""
    t = (topic or "").strip()
    return t if t in TOPICS else TOPIC_FALLBACK


def _get_client():
    global _client
    if _client is None:
        from google.cloud import bigquery  # 遅延 import（無効時は読み込まない）

        _client = bigquery.Client(project=config.PROJECT_ID)
    return _client


def log_interaction(
    company_ticker: str,
    scope_status: str,
    scope_reason: str | None,
    fact_card_count: int,
    citation_count: int,
    topic: str | None = None,
) -> None:
    """1件の Q&A の**メタデータのみ**を BigQuery に記録（匿名・best-effort）。

    質問の本文（原文）は保存しない（プライバシー・バイ・デザイン）。カウントに必要なのは
    話題（topic）・回答状況（scope）・接地度（カード/引用数）だけ。原文が保存されるのは
    ユーザーが CTA で明示同意した ir_requests（/api/ir/contact）のみ。失敗しても例外を投げない。"""
    if not config.ANALYTICS_ENABLED:
        return
    try:
        client = _get_client()
        table = f"{config.PROJECT_ID}.{config.BQ_DATASET}.{config.BQ_TABLE}"
        row = {
            "ts": datetime.now(UTC).isoformat(),  # 日付パーティション列
            "company_ticker": company_ticker or "",
            "scope_status": scope_status or "",
            "scope_reason": scope_reason or None,
            "fact_card_count": int(fact_card_count),
            "citation_count": int(citation_count),
            "topic": topic or None,
        }
        # 挿入は fire-and-forget（応答の final イベントを BQ 往復で待たせない。best-effort は不変）
        threading.Thread(target=_insert_row, args=(client, table, row), daemon=True).start()
    except Exception as e:  # 記録失敗はチャットを壊さない
        _log.warning("analytics log skipped: %s", e)


def _insert_row(client, table: str, row: dict) -> None:
    try:
        errors = client.insert_rows_json(table, [row])
        if errors:
            _log.warning("analytics insert errors: %s", errors)
    except Exception as e:
        _log.warning("analytics log skipped: %s", e)
