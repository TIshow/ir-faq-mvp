"""
層1ストアのディスパッチ（config.FACTS_BACKEND で切替）。

- 'json'     → facts_store（PoC・無料・インフラ不要）
- 'cloudsql' → db（本番・Cloud SQL / Postgres）

条件付き import により、PoC時は google.cloud.sql 等の重い依存を読み込まない
（ローカルで層1＋ガードレール＋評価を GCP なしに検証できる）。
"""

from __future__ import annotations

from . import config

if config.FACTS_BACKEND == "cloudsql":
    from .db import insert_escalation, query_facts, resolve_company_id  # noqa: F401
else:
    from .facts_store import (  # noqa: F401
        insert_escalation,
        query_facts,
        resolve_company_id,
        summary,
    )
