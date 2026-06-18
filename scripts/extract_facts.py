#!/usr/bin/env python3
"""
層1取り込みジョブ（PoC）: 決算PDF → 構造化財務ファクト草案。

Gemini(Vertex) multimodal に GCS のPDFを直接読ませ、明示された数値のみを
構造化JSONで抽出する。出力は verified:false の「草案」。人手検証後に
agent/data/facts.json へ反映する（捏造ゼロの鉄則：AI抽出は検証前提）。

使い方:
  uv run python scripts/extract_facts.py \
    --ticker 5071 --company "株式会社ヴィス" \
    --gcs gs://vis-ir-data/pdf/2025-material.pdf \
    --doc "2025年 決算説明資料" \
    --out agent/data/facts.5071.draft.json

本番は Cloud Run Job 化＋XBRL一次を正本に。詳細は docs/ARCHITECTURE.md。
"""

from __future__ import annotations

import argparse
import json
import sys

from google import genai
from google.genai import types

PROJECT = "hallowed-trail-462613-v1"
LOCATION = "us-central1"
MODEL = "gemini-2.5-flash"

# 抽出する指標の統制語彙（facts.json の metric_key と一致させる）
METRIC_VOCAB = """
- revenue（売上高）
- gross_profit（売上総利益）
- operating_profit（営業利益）
- ordinary_profit（経常利益）
- net_income（親会社株主に帰属する当期純利益）
- dividend_per_share（1株当たり配当）
- segment.<英小文字スラッグ>.revenue（セグメント別売上。例 segment.office.revenue）
- segment.<英小文字スラッグ>.operating_profit（セグメント別利益）
""".strip()

PROMPT = f"""あなたは財務データ抽出の専門家です。添付の日本の決算資料PDFから、
**PDFに明示的に記載されている財務数値のみ**を抽出し、JSON配列で出力してください。

# 厳守事項（捏造禁止）
- PDFに明記された数値だけを抽出する。推定・計算・補完は一切しない（営業利益率などの比率も出さない）。
- 各値について、必ず出典ページ(source_page)と、その数値が載っている**原文の短い引用(source_quote)**を付ける。
- 単位(unit)はPDFの表記に従う（百万円 / 円 等）。value_numeric はその単位での数値（カンマ無しの数）。
- consolidated: 連結=true / 単体=false（不明なら連結=trueと推定せず、記載に従う。判別不能なら出力しない）。
- is_forecast: 「会社予想」「予想」「見通し」の値は true、実績は false。
- period_label: 通期は "2025FY"、四半期は "2025Q1".."2025Q4" 形式。fiscal_year は西暦の整数、fiscal_quarter は1-4または null。

# 抽出対象の指標(metric_key は次の統制語彙のみ使う)
{METRIC_VOCAB}

# 出力JSON（配列のみ。前後に説明文を付けない）
各要素:
{{
  "metric_key": "operating_profit",
  "metric_label_ja": "営業利益",
  "period_label": "2025FY",
  "fiscal_year": 2025,
  "fiscal_quarter": null,
  "value_numeric": 314,
  "unit": "百万円",
  "consolidated": true,
  "is_forecast": false,
  "source_page": 3,
  "source_quote": "営業利益 314"
}}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", required=True)
    ap.add_argument("--company", required=True)
    ap.add_argument("--gcs", required=True, help="gs://.../xxx.pdf")
    ap.add_argument("--doc", required=True, help="出典資料名（例: 2025年 決算説明資料）")
    ap.add_argument("--out", required=True, help="草案の出力先 JSON")
    args = ap.parse_args()

    client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
    print(f"[extract] model={MODEL} pdf={args.gcs}", file=sys.stderr)

    resp = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_uri(file_uri=args.gcs, mime_type="application/pdf"),
            PROMPT,
        ],
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0),
    )

    try:
        raw = json.loads(resp.text)
    except Exception as e:
        print("JSON parse 失敗。生出力:\n" + (resp.text or "")[:2000], file=sys.stderr)
        return 1

    facts = raw if isinstance(raw, list) else raw.get("facts", [])
    # メタを付与（verified=false＝人手検証待ち）
    for f in facts:
        f["ticker"] = args.ticker
        f["source_doc_label"] = args.doc
        f["source_url"] = args.gcs
        f["verified"] = False

    out = {
        "note": f"【草案・未検証】{args.company}({args.ticker}) を {MODEL} で {args.gcs} から抽出。"
                f"人手で値を検証し、verified=true にして agent/data/facts.json へ反映すること。",
        "facts": facts,
    }
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=2)

    print(f"[extract] {len(facts)} 件を抽出 → {args.out}")
    for f in facts:
        print(f"  - {f.get('metric_label_ja')}({f.get('metric_key')}) "
              f"{f.get('period_label')} {f.get('value_numeric')}{f.get('unit')} "
              f"[{'予想' if f.get('is_forecast') else '実績'}/{'連結' if f.get('consolidated') else '単体'}] "
              f"p.{f.get('source_page')}「{f.get('source_quote')}」")
    return 0


if __name__ == "__main__":
    sys.exit(main())
