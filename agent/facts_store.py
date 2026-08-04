"""
層1（financial_facts）の JSON ファイル・バックエンド（PoC）。

Cloud SQL は必須ではない。必須なのは「検証済みの構造化ソースから決定論的に数値を引く」原則。
PoC（1社・数十件・読み取り専用）はこの JSON で十分。本番は db.py（Cloud SQL）に切替（config.FACTS_BACKEND）。

db.query_facts / resolve_company_id / insert_escalation と同じ契約を提供する。
"""

from __future__ import annotations

import json
import pathlib
import re
from typing import Any

from . import config

_DATA_DIR = pathlib.Path(__file__).with_name("data")
_DEFAULT_FACTS_DIR = _DATA_DIR / "facts"
_ESCALATIONS = _DATA_DIR / "escalations.jsonl"

# ティッカー -> そのファイル。プロセス内で1回だけ読む。
# 以前は単一 facts.json を **クエリのたびに全部再パース**していた（1問で3回）。
# 41件なら誤差だが、EDINET全社（実測3,900社=40MB）では1問1.3秒の純粋な無駄になる。
_cache: dict[str, list[dict[str, Any]]] = {}

# ティッカーは**ファイル名になる**ので、英数字だけに限る。
# 証券コードは4桁（新形式の `135A` を含む）、EDINETの secCode は5桁。
# 区切り文字を1つも許さないことで、`../` によるパス外への脱出を成立させない
# （エージェントは呼び出し元を信用しない。#88 で非公開にしたのとは別の層の防御）。
_TICKER_RE = re.compile(r"^[0-9A-Za-z]{1,10}$")


def _facts_dir() -> pathlib.Path:
    return pathlib.Path(config.FACTS_JSON_PATH) if config.FACTS_JSON_PATH else _DEFAULT_FACTS_DIR


def _safe_facts_file(ticker: str) -> pathlib.Path | None:
    """`data/facts/<ticker>.json` の実パス。層1ディレクトリの外を指すなら None。

    ティッカーはリクエスト（エージェント）とURL（`/c/<ticker>`）に由来するので、
    そのままファイル名にすると `../` でディレクトリの外を読める。
    **エージェントは呼び出し元を信用しない**（#88 の非公開化は別の層の防御であって、
    入力を信じてよい理由にはならない）。二重に止める:

      1. 許可文字だけ — 区切り文字を1つも許さない
      2. 解決後の包含確認 — シンボリックリンク等で外に出ていないか実パスで確かめる
    """
    if not _TICKER_RE.match(ticker):
        return None
    base = _facts_dir().resolve()
    p = (base / f"{ticker}.json").resolve()
    return p if p.parent == base else None


def _load(ticker: str) -> list[dict[str, Any]]:
    """その企業のファクトだけを読む（`data/facts/<ticker>.json`）。

    **1社1ファイル**にしてあるのは速度だけが理由ではない。層1は「検証済みの数値だけを
    出す」のが原則で、企業を1社ずつ人が確認して入れる運用になる。1社=1ファイルなら
    その追加が**レビューできる1ファイルの差分**になる（詳細 docs/edinet-ingest.md §6-2）。
    """
    key = str(ticker)
    if key in _cache:
        return _cache[key]
    rows: list[dict[str, Any]] = []
    p = _safe_facts_file(key)
    if p is not None and p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        # ファイルは [..facts..] でも {"facts":[..]} でも可
        rows = data["facts"] if isinstance(data, dict) else data
    _cache[key] = rows
    return rows


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
    for r in _load(company_id):
        # ファイルが企業別になった今も ticker は確認する。取り違えたファイルを置いても
        # 「別の会社の数字を返す」のではなく「何も返さない」で落ちるようにするため。
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
    for r in _load(ticker):
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


def doc_label_for_url(url: str, ticker: str) -> str | None:
    """source_url（gs://…）に対応する人間可読の資料名を、**その企業の** facts から引く。
    層2（検索）の表示名がファイル名由来で素っ気ない場合に、検証済みの資料名へ整える用途。"""
    if not url or not ticker:
        return None
    for r in _load(ticker):
        if r.get("source_url") == url and r.get("source_doc_label"):
            return str(r["source_doc_label"])
    return None


def insert_escalation(company_id: Any, question: str, reason: str, scope_status: str) -> None:
    """拒否・不明の質問を JSONL に追記（PoC）。PIIは持たない。"""
    _ESCALATIONS.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "company_id": company_id,
        "question": question,
        "reason": reason,
        "scope_status": scope_status,
    }
    with _ESCALATIONS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
