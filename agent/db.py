"""Cloud SQL (PostgreSQL) 接続と financial_facts / escalations の照会。

層1（数値）の決定論的データアクセス。YoY・利益率はここでは保存せず tools 側でコード計算する。
"""

from __future__ import annotations

from typing import Any

import sqlalchemy
from google.cloud.sql.connector import Connector

from . import config

_engine: sqlalchemy.engine.Engine | None = None
_connector: Connector | None = None


def get_engine() -> sqlalchemy.engine.Engine:
    """Cloud SQL Connector 経由の SQLAlchemy エンジン（遅延初期化）。"""
    global _engine, _connector
    if _engine is not None:
        return _engine

    if not config.DB_PASSWORD:
        raise RuntimeError(
            "DB_PASSWORD 未設定。Secret Manager から注入してください（agent/.env または Cloud Run env）。"
        )

    _connector = Connector()

    def getconn():
        return _connector.connect(
            config.DB_INSTANCE_CONNECTION_NAME,
            "pg8000",
            user=config.DB_USER,
            password=config.DB_PASSWORD,
            db=config.DB_NAME,
        )

    _engine = sqlalchemy.create_engine("postgresql+pg8000://", creator=getconn, pool_pre_ping=True)
    return _engine


def resolve_company_id(ticker: str) -> int | None:
    """ティッカー（例 '5071'）から company_id を解決。"""
    sql = sqlalchemy.text("SELECT company_id FROM companies WHERE ticker = :t LIMIT 1")
    with get_engine().connect() as conn:
        row = conn.execute(sql, {"t": ticker}).fetchone()
        return int(row[0]) if row else None


def query_facts(
    company_id: int,
    metric_keys: list[str],
    periods: list[str],
    consolidated: bool = True,
    basis: str = "actual",
) -> list[dict[str, Any]]:
    """
    financial_facts を (metric_key, period) で取得。
    検証済み(verified)・指定区分(consolidated/basis)のみ返す。出典も同時に返す。
    """
    is_forecast = basis == "forecast"
    sql = sqlalchemy.text(
        """
        SELECT metric_key, metric_label_ja, period_label, fiscal_year, fiscal_quarter,
               value_numeric, unit, consolidated, is_forecast,
               source_doc_label, source_page, source_url, source_quote
        FROM financial_facts
        WHERE company_id = :cid
          AND metric_key = ANY(:mks)
          AND period_label = ANY(:periods)
          AND consolidated = :cons
          AND is_forecast = :fc
          AND verified = true
        ORDER BY fiscal_year, fiscal_quarter NULLS LAST
        """
    )
    with get_engine().connect() as conn:
        rows = (
            conn.execute(
                sql,
                {
                    "cid": company_id,
                    "mks": list(metric_keys),
                    "periods": list(periods),
                    "cons": consolidated,
                    "fc": is_forecast,
                },
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def insert_escalation(
    company_id: int | None, question: str, reason: str, scope_status: str
) -> None:
    """拒否・不明の質問を IRインテリジェンスとして記録（痛み②）。PIIは持たない。"""
    sql = sqlalchemy.text(
        """
        INSERT INTO escalations (company_id, question, reason, scope_status)
        VALUES (:cid, :q, :reason, :status)
        """
    )
    with get_engine().begin() as conn:
        conn.execute(
            sql, {"cid": company_id, "q": question, "reason": reason, "status": scope_status}
        )
