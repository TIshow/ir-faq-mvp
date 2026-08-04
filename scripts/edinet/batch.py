"""EDINET 有価証券報告書の一括取り込み ＋ カバレッジレポート（#136）。

`client.py`（取得）と `parse.py`（解析）を繋いで、期間内の全上場企業を流す。

設計上の約束:

  - **再開できる** — 3,900件を最初からやり直せない。処理済みの docID を台帳
    （`_coverage.jsonl`・追記のみ）に残し、2回目以降は飛ばす。途中で落ちても
    それまでの行は残る。zipもキャッシュ済みなので再取得は発生しない。
  - **1社の失敗で止めない** — 例外は握って理由を台帳に書き、次へ進む。
    **どの企業がなぜ取れなかったかが、カバレッジ評価そのもの**（#131）。
  - **配信ディレクトリには書かない** — 出力先は `agent/data/facts/` とは別。
    あちらは人が確認した数値だけを置く場所で、取り込んだだけのもの
    （`verified: false`）を混ぜない（#135 の決定・docs/edinet-ingest.md §6-2）。

使い方:

    # 1年分（3月決算が大半なので6月に集中する）
    uv run python scripts/edinet/batch.py --start 2025-08-01 --end 2026-07-31

    # 少数で試す
    uv run python scripts/edinet/batch.py --start 2026-06-25 --end 2026-06-26 --limit 20

    # 台帳からレポートだけ出し直す
    uv run python scripts/edinet/batch.py --report-only
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from edinet.client import EdinetClient, load_api_key  # noqa: E402
from edinet.parse import FailReason, extract  # noqa: E402

DEFAULT_OUT = Path("data/facts-corpus")
DEFAULT_CACHE = Path("data/edinet-cache")
LEDGER_NAME = "_coverage.jsonl"
RUN_META_NAME = "_run.json"  # 所要時間など、1書類に紐づかない情報

# 書類の**公開**PDF。APIの取得URLと違いサブスクリプションキーが要らないので、
# そのまま投資家に見せる出典リンクにできる（`FactCard.toDocHref` は https を素通しする）。
# 実在する docID は 200 / application/pdf、架空の docID は 404 を返すことを確認済み。
PDF_URL = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/{doc_id}.pdf"


# --------------------------------------------------------------------- 重複規則
def merge_facts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """同一（指標×期×実績予想×連結区分）が複数の有報に出たら**提出が新しい方**を採る。

    5年分に広げると同じ決算期が2つの有報に載る（FY2025は FY2025 と FY2026 の両方の
    有報に）。どちらを正とするか決めないと、重複と矛盾がそのまま残る（#130 §5-4）。

    **新しい方を採る。** 訂正や表示組替を経た数字が会社自身の最新の見解であり、
    訂正有報という制度がある以上、古い方を正とする理由が無い。
    どの書類から来た値かは `source_url` と `source_submitted_at` に残るので、
    採用の経緯は後から追える。
    """
    best: dict[tuple[Any, ...], dict[str, Any]] = {}
    # 提出日→docID の順に並べてから最後を採る＝入力順に依存せず結果が決まる
    for r in sorted(
        rows, key=lambda x: (str(x.get("source_submitted_at", "")), str(x.get("source_url", "")))
    ):
        key = (
            r.get("metric_key"),
            r.get("period_label"),
            bool(r.get("is_forecast")),
            bool(r.get("consolidated")),
        )
        best[key] = r
    return sorted(
        best.values(),
        key=lambda r: (str(r.get("metric_key")), int(r.get("fiscal_year") or 0)),
    )


# --------------------------------------------------------------------- 1社ぶん
def process_one(client: EdinetClient, ref: Any, out_dir: Path) -> dict[str, Any]:
    """1書類を取得・抽出し、`<ticker>.json` を更新して台帳の1行を返す。"""
    row: dict[str, Any] = {
        "doc_id": ref.doc_id,
        "ticker": ref.ticker,
        "filer_name": ref.filer_name,
        "submit_date": ref.submit_date,
        "standard": "unknown",
        "consolidated": None,
        "facts": 0,
        "segments": 0,
        "reason": None,
        "zip_bytes": 0,
    }
    try:
        zip_path = client.fetch_zip(ref.doc_id)
        row["zip_bytes"] = zip_path.stat().st_size
        xbrl = EdinetClient.read_public_xbrl(zip_path)
        if xbrl is None:
            row["reason"] = str(FailReason.NO_PUBLIC_XBRL)
            return row

        res = extract(
            xbrl,
            zip_path,
            ticker=ref.ticker,
            doc_label=ref.doc_label,
            source_url=PDF_URL.format(doc_id=ref.doc_id),
        )
        row.update(
            standard=res.standard,
            consolidated=res.consolidated,
            facts=len(res.facts),
            segments=res.segment_count,
            reason=str(res.reason) if res.reason else None,
        )
        if not res.facts:
            return row

        for f in res.facts:
            f["source_submitted_at"] = ref.submit_date

        path = out_dir / f"{ref.ticker}.json"
        existing: list[dict[str, Any]] = []
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8")).get("facts") or []
        merged = merge_facts(existing + res.facts)
        path.write_text(
            json.dumps({"facts": merged}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except Exception as e:  # 1社の失敗で全体を落とさない
        row["reason"] = f"例外: {type(e).__name__}"
    return row


# ----------------------------------------------------------------------- 本体
def run(start: date, end: date, out_dir: Path, cache_dir: Path, limit: int | None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ledger = out_dir / LEDGER_NAME

    done: set[str] = set()
    if ledger.exists():
        for line in ledger.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["doc_id"])
        print(f"再開: 台帳に {len(done)} 件（この分は飛ばす）")

    client = EdinetClient(load_api_key(), cache_dir)
    t0 = time.time()
    n = 0
    with ledger.open("a", encoding="utf-8") as fp:
        for ref in client.iter_annual_reports(start, end):
            if ref.doc_id in done:
                continue
            row = process_one(client, ref, out_dir)
            fp.write(json.dumps(row, ensure_ascii=False) + "\n")
            fp.flush()  # 途中で落ちても直前までは残す
            n += 1
            mark = "✓" if row["facts"] else "✗"
            print(
                f"  {mark} {row['ticker']} {row['filer_name'][:16]:<16} {row['facts']:>3}件",
                flush=True,
            )
            if limit and n >= limit:
                break
    elapsed = time.time() - t0
    print(f"\n{n}件を処理（{elapsed:.1f}秒）")
    # 所要時間は台帳（1行=1書類）に置き場が無いので別ファイルに残す。
    # これが無いと `--report-only` で所要時間が出せない。
    # **足し込む**: 台帳は累積なので、ここだけ最後の再開分になると数字が噛み合わない。
    meta_path = out_dir / RUN_META_NAME
    prior = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    meta_path.write_text(
        json.dumps(
            {
                "processed": int(prior.get("processed") or 0) + n,
                "elapsed_sec": round(float(prior.get("elapsed_sec") or 0) + elapsed, 1),
                "runs": int(prior.get("runs") or 0) + 1,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    return ledger


# --------------------------------------------------------------------- レポート
def report(ledger: Path) -> None:
    if not ledger.exists():
        print(f"台帳が無い: {ledger}")
        return
    rows = [json.loads(x) for x in ledger.read_text(encoding="utf-8").splitlines() if x.strip()]
    if not rows:
        print("台帳が空")
        return

    ok = [r for r in rows if r["facts"] > 0]
    ng = [r for r in rows if r["facts"] == 0]
    counts = [r["facts"] for r in ok]
    segs = [r["segments"] for r in ok]
    total_bytes = sum(r.get("zip_bytes") or 0 for r in rows)

    print("\n" + "=" * 60)
    print("カバレッジレポート")
    print("=" * 60)
    print(f"  対象書類      {len(rows):,}")
    print(f"  抽出成功      {len(ok):,} ({len(ok) / len(rows):.1%})")
    print(f"  抽出0件       {len(ng):,}")
    print(f"  取得量        {total_bytes / 1e9:.2f} GB")

    if ng:
        print("\n  取れなかった理由（黙って欠落させない）:")
        for reason, c in Counter(r["reason"] or "(理由なし)" for r in ng).most_common():
            print(f"    {reason:<24} {c:>5}")

    print("\n  会計基準:")
    for std, c in Counter(r["standard"] for r in ok).most_common():
        print(f"    {std:<24} {c:>5} ({c / len(ok):.1%})")

    print("\n  連結/単体:")
    for con, c in Counter(str(r["consolidated"]) for r in ok).most_common():
        label = {"True": "連結", "False": "単体のみ", "None": "判定不能"}.get(con, con)
        print(f"    {label:<24} {c:>5} ({c / len(ok):.1%})")

    if counts:
        print("\n  ファクト数:")
        print(f"    平均 {statistics.mean(counts):.1f} / 中央値 {statistics.median(counts):.0f}")
        print(f"    最小 {min(counts)} / 最大 {max(counts)}")
        with_seg = sum(1 for s in segs if s > 0)
        print(f"\n  セグメント検出: {with_seg:,}/{len(ok):,} 社 ({with_seg / len(ok):.1%})")
        if with_seg:
            print(f"    のべ {sum(segs):,} 事業 / 平均 {sum(segs) / with_seg:.1f} 事業")

    dates = sorted({r["submit_date"] for r in rows if r.get("submit_date")})
    if dates:
        print(f"\n  提出日の範囲  {dates[0]} 〜 {dates[-1]}")
    meta_path = ledger.with_name(RUN_META_NAME)
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        secs = meta.get("elapsed_sec") or 0
        per = f" / {secs / len(rows):.2f} 秒/社" if rows else ""
        print(f"  所要時間      {secs / 60:.1f} 分{per}")
    print("=" * 60)


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main() -> None:
    ap = argparse.ArgumentParser(description="EDINET 有報の一括取り込み＋カバレッジレポート")
    ap.add_argument("--start", type=_parse_date, help="取得開始日 YYYY-MM-DD")
    ap.add_argument("--end", type=_parse_date, help="取得終了日 YYYY-MM-DD")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"出力先（既定 {DEFAULT_OUT}）")
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="zip/一覧のキャッシュ先")
    ap.add_argument("--limit", type=int, help="この件数で打ち切る（試走用）")
    ap.add_argument("--report-only", action="store_true", help="取得せず台帳からレポートのみ")
    args = ap.parse_args()

    ledger = args.out / LEDGER_NAME
    if not args.report_only:
        if not (args.start and args.end):
            ap.error("--start と --end が要る（--report-only なら不要）")
        ledger = run(args.start, args.end, args.out, args.cache, args.limit)
    report(ledger)


if __name__ == "__main__":
    main()
