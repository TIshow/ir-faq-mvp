"""Q&Aインタラクションの永続ログ（痛み②: IRインテリジェンスの土台）。

全Q&Aを BigQuery に**匿名・集計用**で記録する（回答率/エスカレーション/頻出論点の分析用）。
個人識別子は持たない（プライバシー・バイ・デザイン）。

原則:
- **best-effort**：記録失敗はチャット応答を壊さない（例外は握り潰してログのみ）。
- **ゲート**：config.ANALYTICS_ENABLED が False なら何もしない（ローカル/評価でテーブルを汚さない）。
- **遅延import**：無効時に google-cloud-bigquery を読み込まない。
- 書込は streaming insert（低volumeでほぼ無料）。テーブルは ts 日付パーティション＋company_ticker クラスタ。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from . import config

_log = logging.getLogger("ir-agent.analytics")
_client = None  # 遅延生成した BigQuery クライアントのキャッシュ


def _get_client():
    global _client
    if _client is None:
        from google.cloud import bigquery  # 遅延 import（無効時は読み込まない）

        _client = bigquery.Client(project=config.PROJECT_ID)
    return _client


def log_interaction(
    company_ticker: str,
    question: str,
    scope_status: str,
    scope_reason: str | None,
    fact_card_count: int,
    citation_count: int,
) -> None:
    """1件の Q&A を BigQuery に記録（匿名・best-effort）。失敗しても例外を投げない。"""
    if not config.ANALYTICS_ENABLED:
        return
    try:
        client = _get_client()
        table = f"{config.PROJECT_ID}.{config.BQ_DATASET}.{config.BQ_TABLE}"
        # 誹謗中傷はマスクして保存（IRダッシュボードの頻出質問・集計に罵倒/名誉毀損を出さない）。
        q = "[不適切な内容]" if scope_reason == "inappropriate" else (question or "")[:1000]
        row = {
            "ts": datetime.now(UTC).isoformat(),  # 日付パーティション列
            "company_ticker": company_ticker or "",
            "question": q,
            "scope_status": scope_status or "",
            "scope_reason": scope_reason or None,
            "fact_card_count": int(fact_card_count),
            "citation_count": int(citation_count),
        }
        errors = client.insert_rows_json(table, [row])
        if errors:
            _log.warning("analytics insert errors: %s", errors)
    except Exception as e:  # 記録失敗はチャットを壊さない
        _log.warning("analytics log skipped: %s", e)
