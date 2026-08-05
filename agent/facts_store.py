"""
層1（financial_facts）の JSON バックエンド。**1社1ファイル**（`<ticker>.json`）。

必須なのは「検証済みの構造化ソースから決定論的に数値を引く」原則であって、DBそのものではない。
層1の参照は「ティッカー1件 → 十数件」の完全なキー引きなので、常時起動DBを持つ理由が無い
（#135 で計測のうえ Cloud SQL / BigQuery を採らないと決めた。経緯は docs/edinet-ingest.md §6-2）。
`config.FACTS_BACKEND=cloudsql` にすれば db.py へ切替できる口は残してある。

## 読み出しは2系統（#148）

  1. **同梱**（`agent/data/facts/`）… 人が確認して入れた顧客企業。
     イメージに焼き込まれ、読み出しは0ms。**こちらが優先**
  2. **GCS**（`FACTS_GCS_BUCKET`）… EDINETから機械が作った3,825社。
     144MBをイメージに入れず、初回だけ取得してプロセス内にキャッシュする

同梱を優先するのは、顧客企業の**人手検証済みの値**が機械生成で上書きされないようにするため。
同じティッカーが両方にある場合、正は常に同梱側。

GCSが未設定なら同梱だけで動く（ローカル開発・テストはこの状態）。

db.query_facts / resolve_company_id / insert_escalation と同じ契約を提供する。
"""

from __future__ import annotations

import json
import logging
import pathlib
import re
from typing import Any

from google.api_core.exceptions import NotFound

from . import config

_log = logging.getLogger(__name__)

_DATA_DIR = pathlib.Path(__file__).with_name("data")
_DEFAULT_FACTS_DIR = _DATA_DIR / "facts"
_ESCALATIONS = _DATA_DIR / "escalations.jsonl"

# ティッカー -> そのファクト。読んだものだけ、プロセス内で1回だけ。
# 以前は単一 facts.json を **クエリのたびに全部再パース**していた（実測 1問9.0回）。
# 41件なら誤差だが、EDINET全社（実測3,900社=40MB）では1問あたり約3.9秒の純粋な無駄になる。
_cache: dict[str, list[dict[str, Any]]] = {}

# ティッカー -> 実ファイル。層1ディレクトリを1回だけ列挙して作る。
_index: dict[str, pathlib.Path] | None = None


def _facts_dir() -> pathlib.Path:
    return pathlib.Path(config.FACTS_DIR) if config.FACTS_DIR else _DEFAULT_FACTS_DIR


def _file_index() -> dict[str, pathlib.Path]:
    """`data/facts/*.json` を列挙して「ティッカー -> パス」を作る（1回だけ）。

    **ティッカーからパスを組み立てない。** ティッカーはリクエスト（エージェント）と
    URL（`/c/<ticker>`）に由来するので、`f"{ticker}.json"` と繋ぐと `../` で
    ディレクトリの外を読める。ディレクトリに実在するファイルだけを引く形にすれば、
    読める対象が層1ディレクトリの中身そのものに限定され、脱出する経路が無くなる。
    （#88 でエージェントを非公開にしたのは別の層の防御で、入力を信じてよい理由にはならない。）
    """
    global _index
    if _index is None:
        d = _facts_dir()
        _index = {p.stem: p for p in sorted(d.glob("*.json"))} if d.is_dir() else {}
    return _index


# GCSは**ティッカーが許可文字だけのときにしか触らない**。同梱側は実在ファイルの索引を
# 引くので脱出できないが、GCSはキーを組み立てる必要があるため（`facts/<ticker>.json`）、
# ここで塞ぐ。証券コードは4桁（新形式の `135A` を含む）、EDINETの secCode は5桁。
_TICKER_RE = re.compile(r"^[0-9A-Za-z]{1,10}$")


_gcs_bucket = None  # storage.Bucket。認証とHTTPセッションを使い回す


def _bucket():
    """GCSバケットのハンドル（プロセス内で1回だけ作る）。

    **毎回 `storage.Client()` を作らない。** 認証情報の解決とHTTPセッションの確立が
    その都度走り、実測で初回2.4秒かかっていた。作り直さなければ以降は接続を使い回せる。
    """
    global _gcs_bucket
    if _gcs_bucket is None:
        from google.cloud import storage  # 遅延import: GCS未使用の環境で依存を要求しない

        _gcs_bucket = storage.Client().bucket(config.FACTS_GCS_BUCKET)
    return _gcs_bucket


def _load_from_gcs(ticker: str) -> list[dict[str, Any]] | None:
    """GCSから1社ぶん読む。バケット未設定・オブジェクト無し・失敗は None。

    **1社=1オブジェクト**なので、読むのは実測8.3KB。初回だけで以降はキャッシュに乗る
    （キャッシュ機構は #135 のものをそのまま使う）。
    """
    if not config.FACTS_GCS_BUCKET or not _TICKER_RE.match(ticker):
        return None
    try:
        blob = _bucket().blob(f"{config.FACTS_GCS_PREFIX}{ticker}.json")
        # `exists()` は往復が1回増える。**ダウンロードを試して404を捕まえる**方が速い。
        data = json.loads(blob.download_as_bytes())
    except NotFound:
        return None
    except Exception:
        # **数値が出ないだけで、誤った数値は出ない。** 取得できなければ
        # 「まだ取り込まれていません」と正直に答える経路に落ちる（#154）。
        _log.warning("層1のGCS取得に失敗: ticker=%s", ticker)
        return None
    return data["facts"] if isinstance(data, dict) else data


def _load(ticker: str) -> list[dict[str, Any]]:
    """その企業のファクトだけを読む（`data/facts/<ticker>.json`）。

    **1社1ファイル**にしてあるのは速度だけが理由ではない。層1は「検証済みの数値だけを
    出す」のが原則で、企業を1社ずつ人が確認して入れる運用になる。1社=1ファイルなら
    その追加が**レビューできる1ファイルの差分**になる（詳細 docs/edinet-ingest.md §6-2）。
    """
    key = str(ticker)
    if key in _cache:
        return _cache[key]

    p = _file_index().get(key)
    if p is not None:
        # 同梱（人手検証済み）が優先。機械生成で上書きされないようにする。
        data = json.loads(p.read_text(encoding="utf-8"))
        # ファイルは [..facts..] でも {"facts":[..]} でも可
        rows: list[dict[str, Any]] = data["facts"] if isinstance(data, dict) else data
        _cache[key] = rows
        return rows

    rows = _load_from_gcs(key) or []
    if not rows:
        # **見つからないティッカーはキャッシュしない。** ティッカーは外から来るので、
        # 空振りも覚えると任意の文字列でdictが際限なく育つ。
        return []
    _cache[key] = rows
    return rows


def _is_usable(row: dict[str, Any]) -> bool:
    """このファクトを回答に使ってよいか。**採用条件をここ1か所に定義する。**

    2つの経路があり、**担保しているものが違う**（#145）:

    - `verified: true` — 人が原本と突き合わせた。PDFからの抽出（LLM経由）は
      読み違えが起こりうるので、これが要る。
    - `source_kind == "xbrl"` — 提出企業の正本XBRLからタグを読んだだけ。
      値の読み違えが原理的に起こらないので、検証すべきは企業ではなく**抽出器**
      （ハークスレイの人手検証データと突合して不一致0を確認済み・
      docs/edinet-ingest.md §4）。3,900社を人手検証はできない以上、
      この道を通さないと非顧客企業には一切答えられない。

    **`verified` を XBRL に流用しない。** 「人が確認した」と「抽出器が検証済み」は
    別の主張で、UIの表示（公式IR / 非公式IR）もコンプラ上の姿勢も変わる。
    片方に潰すと後から分けられない。
    """
    return bool(row.get("verified", False)) or row.get("source_kind") == "xbrl"


def _verified_rows(ticker: str) -> list[dict[str, Any]]:
    """その企業の**採用してよい**ファクトだけ。

    `ticker` はファイル名だけでなく中身でも確認する。取り違えたファイルを置いても
    「別の会社の数字を返す」のではなく「何も返さない」で落ちるようにするため。

    フィルタ済みの新しいリストを返すので、`_cache` の中身が呼び出し側に漏れない。
    """
    tk = str(ticker)
    return [r for r in _load(tk) if str(r.get("ticker")) == tk and _is_usable(r)]


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
    for r in _verified_rows(company_id):
        if r.get("metric_key") not in mks or r.get("period_label") not in ps:
            continue
        if bool(r.get("consolidated", True)) != consolidated:
            continue
        if bool(r.get("is_forecast", False)) != is_forecast:
            continue
        out.append(dict(r))
    out.sort(key=lambda r: (r.get("fiscal_year", 0), r.get("fiscal_quarter") or 0))
    return out


def summary(ticker: str) -> dict[str, Any]:
    """その企業で利用可能な期間・指標キーを返す（プロンプト接地用）。"""
    periods_actual, periods_forecast, metrics = [], [], {}
    for r in _verified_rows(ticker):
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
    for r in _verified_rows(ticker):
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
