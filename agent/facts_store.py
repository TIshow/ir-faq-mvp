"""
層1（financial_facts）の JSON ファイル・バックエンド（PoC）。

Cloud SQL は必須ではない。必須なのは「検証済みの構造化ソースから決定論的に数値を引く」原則。
PoC（1社・数十件・読み取り専用）はこの JSON で十分。本番は db.py（Cloud SQL）に切替（config.FACTS_BACKEND）。

db.query_facts / resolve_company_id / insert_escalation と同じ契約を提供する。
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

from . import config

_DATA_DIR = pathlib.Path(__file__).with_name("data")
_DEFAULT_FACTS = _DATA_DIR / "vis_facts.json"
_ESCALATIONS = _DATA_DIR / "escalations.jsonl"


def _facts_path() -> pathlib.Path:
    return pathlib.Path(config.FACTS_JSON_PATH) if config.FACTS_JSON_PATH else _DEFAULT_FACTS


def _load() -> list[dict[str, Any]]:
    p = _facts_path()
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    # ファイルは [..facts..] でも {"facts":[..]} でも可
    return data["facts"] if isinstance(data, dict) else data


def resolve_company_id(ticker: str) -> str:
    """JSONバックエンドでは ticker をそのまま識別子に使う（db版は int を返す）。"""
    return ticker


def query_facts(
    company_id: Any,
    metric_keys: list[str],
    periods: list[str],
    consolidated: bool = True,
    basis: str = "actual",
) -> list[dict[str, Any]]:
    """db.query_facts と同契約。検証済み・指定区分のファクトのみ返す。"""
    is_forecast = basis == "forecast"
    mks, ps = set(metric_keys), set(periods)
    out: list[dict[str, Any]] = []
    for r in _load():
        if str(r.get("ticker")) != str(company_id):
            continue
        if r.get("metric_key") not in mks or r.get("period_label") not in ps:
            continue
        if bool(r.get("consolidated", True)) != consolidated:
            continue
        if bool(r.get("is_forecast", False)) != is_forecast:
            continue
        if not r.get("verified", False):
            continue
        out.append(dict(r))
    out.sort(key=lambda r: (r.get("fiscal_year", 0), r.get("fiscal_quarter") or 0))
    return out


def summary(ticker: str) -> dict[str, Any]:
    """その企業で利用可能な期間・指標キーを返す（プロンプト接地用）。"""
    periods_actual, periods_forecast, metrics = [], [], {}
    for r in _load():
        if str(r.get("ticker")) != str(ticker) or not r.get("verified", False):
            continue
        p = r.get("period_label")
        if r.get("is_forecast"):
            if p not in periods_forecast:
                periods_forecast.append(p)
        elif p not in periods_actual:
            periods_actual.append(p)
        metrics[r.get("metric_key")] = r.get("metric_label_ja")
    return {
        "periods_actual": sorted(periods_actual),
        "periods_forecast": sorted(periods_forecast),
        "metrics": metrics,
    }


def insert_escalation(company_id: Any, question: str, reason: str, scope_status: str) -> None:
    """拒否・不明の質問を JSONL に追記（PoC）。PIIは持たない。"""
    _ESCALATIONS.parent.mkdir(parents=True, exist_ok=True)
    rec = {"company_id": company_id, "question": question, "reason": reason, "scope_status": scope_status}
    with _ESCALATIONS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
