"""EDINETコード一覧 → 非顧客企業のレジストリ（#154）。

`companies.ts` は**顧客企業の契約情報**（`datastoreId` / `isCustomer` /
`publishOfficialQa`）を持つ場所であり、上場企業3,829社を書く場所ではない。
非顧客はここで生成した JSON を**サーバー側だけ**で読む。

## なぜクライアントに渡さないか

実測: 3,829社をJSONにすると **617KB**。フロントの初期JS共有分は103KBなので、
バンドルに載せると6倍になり、全訪問者がダウンロードすることになる。

したがって非顧客への到達は「検索して `/c/<ticker>` に飛ぶ」経路に一本化する
（3,829社をカードで並べる案は元から成立しない）。

## 何を持ち、何を持たないか

持つのは**EDINETの一次情報だけ**（#154 の3層のうち①）:
  name / nameEn / ticker / sector / fiscalYearEndMonth

持たないもの:
  - `datastoreId` / `isCustomer` / `publishOfficialQa` … 契約・インフラ（②・コード側）
  - `description` / `guidedQuestions` … 発行体が編集する項目（③・非顧客には主体がいない）

**顧客企業はこのファイルから除く。** `companies.ts` が正で、二重に持つと食い違う。

使い方:

    uv run python scripts/edinet/build_registry.py --out src/data/listed-companies.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from codelist import Filer, fetch

DEFAULT_OUT = Path("src/data/listed-companies.json")
DEFAULT_CACHE = Path("data/edinet-cache")

# `companies.ts` から**顧客企業**のティッカーを読む。TSはパースせず、
# 1エントリ（`{ ... }`）ごとに `ticker` と `datastoreId` の有無を見る。
#
# **「companies.ts にある」ではなく「顧客である」で除外する。**
# 非顧客企業も動作確認のために companies.ts に入りうる（実際 4063 がそう）。
# それを除外すると、その企業だけレジストリから消えて検索に出なくなる。
_ENTRY = re.compile(r"\{[^{}]*\}", re.S)
_TICKER = re.compile(r"ticker:\s*'([0-9A-Za-z]{1,10})'")
_DATASTORE = re.compile(r"datastoreId:\s*'")


def customer_tickers(companies_ts: Path) -> set[str]:
    """`companies.ts` の**顧客企業**（`datastoreId` を持つもの）のティッカー。

    レジストリは非顧客だけを持つ。顧客は `companies.ts` が正で、
    二重に持つと食い違う（社名変更時にどちらが正か分からなくなる）。
    """
    if not companies_ts.exists():
        return set()
    src = companies_ts.read_text(encoding="utf-8")
    out: set[str] = set()
    for entry in _ENTRY.findall(src):
        m = _TICKER.search(entry)
        if m and _DATASTORE.search(entry):
            out.add(m.group(1))
    return out


def to_record(f: Filer) -> dict[str, object]:
    """レジストリの1件。**空文字は入れない**（未取得と空文字を区別する）。"""
    rec: dict[str, object] = {"ticker": f.ticker, "name": f.name}
    if f.name_en:
        rec["nameEn"] = f.name_en
    if f.sector:
        rec["sector"] = f.sector
    if f.fiscal_year_end_month:
        rec["fiscalYearEndMonth"] = f.fiscal_year_end_month
    return rec


def build(cache_dir: Path, companies_ts: Path) -> list[dict[str, object]]:
    filers = fetch(cache_dir)
    skip = customer_tickers(companies_ts)
    return [to_record(f) for f in sorted(filers, key=lambda x: x.ticker) if f.ticker not in skip]


def main() -> None:
    ap = argparse.ArgumentParser(description="EDINETコード一覧から非顧客企業レジストリを生成")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    ap.add_argument(
        "--companies-ts", type=Path, default=Path("src/config/companies.ts"), help="顧客企業の正"
    )
    args = ap.parse_args()

    records = build(args.cache, args.companies_ts)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # 1行1社。差分が読める形にする（3,829行の配列を1行にすると diff が意味を持たない）。
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False, sort_keys=True) for r in records)
    args.out.write_text(f"[\n{body}\n]\n", encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    print(f"{args.out}: {len(records):,} 社 / {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
