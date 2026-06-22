#!/usr/bin/env python3
"""
層1取り込みジョブ（EDINET XBRL版）: 有価証券報告書/四半期報告書XBRL → 構造化財務ファクト草案。

短信XBRL（TDnetサマリー）が手元に無い場合の一次として、EDINETの有報/半期XBRL
（jpcrp/jppfs タクソノミ）から **決定論的に** 連結ヘッドライン＋セグメントを抽出する。
数値はタグ付きで一意に取れるため、PDFのGemini抽出より堅牢（捏造リスクゼロ）。

出力は verified:false の「草案」。説明会資料PDF等と突き合わせて検証し、引用（ページ）を
紐づけてから agent/data/facts.json へ反映する（鉄則：AI/自動抽出は人手検証前提）。

EDINETのコンテキストIDは人間可読で標準化されているため、コンテキスト分類はID文字列で行う
（CurrentYearDuration=当期・連結ヘッドライン / Prior1YearDuration=前期 / _NonConsolidated=単体 /
 _<SegmentMember>=セグメント）。

使い方:
  uv run python scripts/extract_facts_xbrl.py \
    --xbrl /path/PublicDoc/jpcrp030000-asr-001_..._.xbrl \
    --ticker 7561 --company "株式会社ハークスレイ" \
    --doc "2026年3月期 有価証券報告書" --url "gs://harux-ir-data/xbrl/2026-asr.xbrl" \
    --out agent/data/facts.7561.draft.json
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def _ln(tag: str) -> str:
    """名前空間を除いたローカル名。"""
    return tag.split("}")[-1]


# 連結ヘッドラインの指標: EDINET要素ローカル名 -> (metric_key, 日本語, 種別)
# 種別 money=百万円(÷1e6) / yen=円(そのまま)
HEADLINE: dict[str, tuple[str, str, str]] = {
    "NetSales": ("revenue", "売上高", "money"),
    "GrossProfit": ("gross_profit", "売上総利益", "money"),
    "OperatingIncome": ("operating_profit", "営業利益", "money"),
    "OrdinaryIncome": ("ordinary_profit", "経常利益", "money"),
    "ProfitLossAttributableToOwnersOfParent": (
        "net_income",
        "親会社株主に帰属する当期純利益",
        "money",
    ),
    "BasicEarningsLossPerShare": ("eps", "1株当たり当期純利益", "yen"),
}

# セグメントmember（コンテキストID末尾）-> (slug, 日本語)。発行体ごとに追記する。
SEGMENTS: dict[str, tuple[str, str]] = {
    "TakeoutLunchBusinessReportableSegmentsMember": ("takeout_lunch", "中食事業"),
    "StoreAssetAndSolutionBusinessReportableSegmentsMember": (
        "store_asset_solution",
        "店舗アセット＆ソリューション事業",
    ),
    "LogisticsFoodProcessingBusinessReportableSegmentsMember": (
        "logistics_food",
        "物流・食品加工事業",
    ),
}
SEG_METRICS = {"NetSales": "revenue", "OperatingIncome": "operating_profit"}

# 当期/前期のヘッドライン・コンテキスト（連結・無次元）
PERIOD_IDS = {"CurrentYearDuration": "current", "Prior1YearDuration": "prior1"}


def _context_enddates(root: ET.Element) -> dict[str, str]:
    """context id -> 期末日（endDate or instant）。fiscal_year 算出に使う。

    注: ElementTree の iter() は名前空間ワイルドカード `{*}` を解さないため、
    全要素を走査してローカル名で判定する（名前空間非依存で堅牢）。
    """
    out: dict[str, str] = {}
    for ctx in root.iter():
        if _ln(ctx.tag) != "context":
            continue
        cid = ctx.get("id")
        if not cid:
            continue
        end = inst = None
        for child in ctx.iter():
            lname = _ln(child.tag)
            if lname == "endDate" and child.text:
                end = child.text.strip()
            elif lname == "instant" and child.text:
                inst = child.text.strip()
        if end or inst:
            out[cid] = end or inst
    return out


def _fiscal_year(enddate: str) -> int:
    """期末日 'YYYY-MM-DD' から fiscal_year（=期末の西暦年）。"""
    return int(enddate[:4])


def _fmt(value: int, kind: str) -> tuple[float, str]:
    """raw(円) -> (表示数値, 単位)。money は百万円換算。"""
    if kind == "money":
        return round(value / 1_000_000), "百万円"
    return value, "円"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xbrl", required=True, help="EDINET XBRLインスタンス(.xbrl)のパス")
    ap.add_argument("--ticker", required=True)
    ap.add_argument("--company", required=True)
    ap.add_argument("--doc", required=True, help="出典資料名（例: 2026年3月期 有価証券報告書）")
    ap.add_argument("--url", default="", help="出典URL（gs://... 等）")
    ap.add_argument("--out", required=True, help="草案の出力先 JSON")
    args = ap.parse_args()

    root = ET.parse(args.xbrl).getroot()
    enddates = _context_enddates(root)
    facts: list[dict[str, Any]] = []

    def add(metric_key, label, period_id, raw, kind):
        end = enddates.get(period_id)
        if end is None:
            return
        fy = _fiscal_year(end)
        val, unit = _fmt(int(raw), kind)
        facts.append(
            {
                "ticker": args.ticker,
                "metric_key": metric_key,
                "metric_label_ja": label,
                "period_label": f"{fy}FY",
                "fiscal_year": fy,
                "fiscal_quarter": None,
                "value_numeric": val,
                "unit": unit,
                "consolidated": True,
                "is_forecast": False,
                "source_doc_label": args.doc,
                "source_url": args.url,
                "source_page": None,
                "source_quote": f"{label} {val}{unit}（XBRL {period_id}, end={end}）",
                "verified": False,
            }
        )

    for el in root.iter():
        name = _ln(el.tag)
        cref = el.get("contextRef")
        if not cref or el.text is None:
            continue
        raw = el.text.strip()
        if not raw.lstrip("-").isdigit():
            continue

        # 1) 連結ヘッドライン（無次元の当期/前期コンテキストのみ）
        if name in HEADLINE and cref in PERIOD_IDS:
            mk, label, kind = HEADLINE[name]
            add(mk, label, cref, raw, kind)
            continue

        # 2) セグメント（当期/前期 × 報告セグメント）
        if name in SEG_METRICS:
            for seg_member, (slug, seg_label) in SEGMENTS.items():
                for pid in PERIOD_IDS:
                    if cref.startswith(pid + "_") and cref.endswith(seg_member):
                        sub = SEG_METRICS[name]
                        add(
                            f"segment.{slug}.{sub}",
                            f"{seg_label}（{'売上高' if sub == 'revenue' else '営業利益'}）",
                            pid,
                            raw,
                            "money",
                        )

    # 重複排除（同じ metric_key×period が複数コンテキストで一致する場合の保険）
    seen, uniq = set(), []
    for f in facts:
        k = (f["metric_key"], f["period_label"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(f)

    out = {
        "note": f"【草案・未検証】{args.company}({args.ticker}) を EDINET XBRL から決定論抽出。"
        "説明会資料等と突合し、引用ページを紐づけてから facts.json へ反映すること。",
        "facts": uniq,
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[xbrl] {len(uniq)} 件を抽出 → {args.out}", file=sys.stderr)
    for f in sorted(uniq, key=lambda x: (x["metric_key"], x["period_label"])):
        print(f"  {f['period_label']} {f['metric_key']:34s} = {f['value_numeric']}{f['unit']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
