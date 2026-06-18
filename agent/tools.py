"""
IR Agent のツール（ADKが function tool として自動ラップ）。

- get_financial_facts: 層1（決定論DB）。YoY・利益率はここでコード計算。
- search_disclosures: 層2（既存 Discovery Engine データストア）。引用付きパッセージ。
- escalate_to_ir: 拒否・不明をIRへ記録（痛み②）。

ツールは純関数として FactCard / Citation 形（agent-types.ts と一致）の dict を返す。
fact_cards の最終合成は agent.py がツール戻り値を捕捉して行う（数値はLLMの文章を経由させない）。
"""

from __future__ import annotations

import html
import re
from typing import Any

from . import config, store

# DB に無く、構成要素から計算する派生指標: key -> (分子, 分母, 表示名)
DERIVED_METRICS: dict[str, tuple[str, str, str]] = {
    "operating_margin": ("operating_profit", "revenue", "営業利益率"),
    "gross_margin": ("gross_profit", "revenue", "売上総利益率"),
    "net_margin": ("net_income", "revenue", "当期純利益率"),
}

# 既定の company（PoC=ヴィス）
DEFAULT_TICKER = "5071"


def _fmt_value(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value:.1f}%"
    # 百万円・円などは桁区切り（小数は落とす）
    return f"{int(round(value)):,}{unit}"


def _fmt_yoy(curr: float, prev: float) -> str | None:
    if prev == 0:
        return None
    pct = (curr - prev) / abs(prev) * 100.0
    sign = "+" if pct >= 0 else "-"
    return f"{sign}{abs(pct):.1f}%"


def _to_card(row: dict[str, Any], yoy: str | None = None) -> dict[str, Any]:
    return {
        "metric": row["metric_label_ja"],
        "metricKey": row["metric_key"],
        "period": row["period_label"],
        "value": _fmt_value(float(row["value_numeric"]), row["unit"]),
        "valueNumeric": float(row["value_numeric"]),
        "unit": row["unit"],
        "yoy": yoy,
        "consolidated": bool(row["consolidated"]),
        "basis": "forecast" if row["is_forecast"] else "actual",
        "source": {
            "doc": row.get("source_doc_label"),
            "page": row.get("source_page"),
            "url": row.get("source_url"),
            "quote": row.get("source_quote"),
        },
    }


def _latest_period(periods: list[str]) -> str | None:
    """'2025FY' / '2025Q2' を年・四半期でソートし最新を返す。"""
    def keyf(p: str):
        m = re.match(r"(\d{4})(?:Q(\d))?", p)
        if not m:
            return (0, 0)
        return (int(m.group(1)), int(m.group(2) or 9))  # 通期(FY)はQ末扱いで最後
    return max(periods, key=keyf) if periods else None


def get_financial_facts(
    metric_keys: list[str],
    periods: list[str],
    consolidated: bool = True,
    basis: str = "actual",
    company_ticker: str = DEFAULT_TICKER,
) -> dict[str, Any]:
    """
    指定銘柄の財務数値を取得する。営業利益率などの派生指標はコードで計算する。
    必ず開示済み・検証済みのファクトのみを返し、各値に出典を付ける。

    Args:
        metric_keys: 取得する指標キー（例 ['operating_profit','revenue','operating_margin',
            'segment.office.revenue']）。
        periods: 期間ラベル（例 ['2025FY','2024FY']）。前年比を出すには2期以上を渡す。
        consolidated: 連結=True / 単体=False。
        basis: 'actual'（実績） / 'forecast'（会社予想）。
        company_ticker: 証券コード（既定はヴィス 5071）。

    Returns:
        {'facts': [FactCard...]} 形式。見つからない場合 facts は空。
    """
    company_id = store.resolve_company_id(company_ticker)
    if company_id is None:
        return {"facts": [], "note": f"企業(ticker={company_ticker})が見つかりません"}

    requested = list(metric_keys)
    base_keys = [k for k in requested if k not in DERIVED_METRICS]
    derived_keys = [k for k in requested if k in DERIVED_METRICS]

    # 派生指標の構成要素も取得対象に加える
    needed = set(base_keys)
    for dk in derived_keys:
        num, den, _ = DERIVED_METRICS[dk]
        needed.update([num, den])

    rows = store.query_facts(company_id, sorted(needed), periods, consolidated, basis)

    # (metric_key, period) -> row
    by_kp: dict[tuple[str, str], dict[str, Any]] = {
        (r["metric_key"], r["period_label"]): r for r in rows
    }
    latest = _latest_period(periods)

    cards: list[dict[str, Any]] = []

    # 1) ベース指標カード（YoY 付き）
    for k in base_keys:
        for p in periods:
            row = by_kp.get((k, p))
            if not row:
                continue
            yoy = None
            if p == latest:
                # 最新期に対し、それ以外の最古期を前年として YoY
                prevs = [pp for pp in periods if pp != latest]
                prev_p = _latest_period(prevs) if prevs else None
                prev_row = by_kp.get((k, prev_p)) if prev_p else None
                if prev_row:
                    yoy = _fmt_yoy(float(row["value_numeric"]), float(prev_row["value_numeric"]))
            cards.append(_to_card(row, yoy))

    # 2) 派生指標（利益率）をコード計算
    for dk in derived_keys:
        num_k, den_k, label = DERIVED_METRICS[dk]
        for p in periods:
            num_row = by_kp.get((num_k, p))
            den_row = by_kp.get((den_k, p))
            if not num_row or not den_row or float(den_row["value_numeric"]) == 0:
                continue
            margin = float(num_row["value_numeric"]) / float(den_row["value_numeric"]) * 100.0
            cards.append({
                "metric": label,
                "metricKey": dk,
                "period": p,
                "value": _fmt_value(margin, "%"),
                "valueNumeric": round(margin, 4),
                "unit": "%",
                "yoy": None,
                "consolidated": consolidated,
                "basis": "forecast" if basis == "forecast" else "actual",
                # 構成要素の出典を引用（計算の根拠）
                "source": _to_card(num_row)["source"],
            })

    return {"facts": cards}


def _clean(text: str) -> str:
    text = re.sub(r"<[^>]*>", "", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def search_disclosures(query: str, company_ticker: str = DEFAULT_TICKER) -> dict[str, Any]:
    """
    開示資料（説明会資料・有報・短信等）から、質問に関連する定性的な記述を引用付きで検索する。
    「なぜ」「背景」「戦略」などの説明に使う。数値の根拠には get_financial_facts を使うこと。

    Returns:
        {'passages': [{'text','doc','page','url','quote'}...]}
    """
    # PoC: 既存 Discovery Engine データストア（ヴィス）を再利用
    from google.cloud import discoveryengine_v1 as de

    client = de.SearchServiceClient()
    serving_config = config.datastore_serving_config(config.VIS_DATASTORE_ID)

    request = de.SearchRequest(
        serving_config=serving_config,
        query=query,
        page_size=config.MAX_DISCLOSURE_RESULTS,
        content_search_spec=de.SearchRequest.ContentSearchSpec(
            snippet_spec=de.SearchRequest.ContentSearchSpec.SnippetSpec(return_snippet=True),
            extractive_content_spec=de.SearchRequest.ContentSearchSpec.ExtractiveContentSpec(
                max_extractive_answer_count=2,
            ),
        ),
        query_expansion_spec=de.SearchRequest.QueryExpansionSpec(
            condition=de.SearchRequest.QueryExpansionSpec.Condition.AUTO,
        ),
        language_code="ja",
    )

    passages: list[dict[str, Any]] = []
    try:
        response = client.search(request)
        for result in response.results:
            doc = result.document
            derived = dict(doc.derived_struct_data or {})
            title = derived.get("title") or derived.get("link") or "開示資料"
            link = derived.get("link")
            # extractive answers / snippets を取り出す
            chunks: list[tuple[str, int | None]] = []
            for ea in derived.get("extractive_answers", []) or []:
                if isinstance(ea, dict) and ea.get("content"):
                    page = ea.get("pageNumber")
                    chunks.append((ea["content"], int(page) if page else None))
            for sn in derived.get("snippets", []) or []:
                if isinstance(sn, dict) and sn.get("snippet"):
                    chunks.append((sn["snippet"], None))
            for content, page in chunks:
                cleaned = _clean(content)
                if len(cleaned) > 10:
                    passages.append({
                        "text": cleaned,
                        "doc": title,
                        "page": page,
                        "url": link,
                        "quote": cleaned[:300],
                    })
    except Exception as e:  # 検索失敗時も落とさず空で返す（エージェントが escalate を判断）
        return {"passages": [], "error": str(e)}

    return {"passages": passages}


def escalate_to_ir(question: str, reason: str = "out_of_corpus", company_ticker: str = DEFAULT_TICKER) -> dict[str, Any]:
    """
    開示資料で答えられない正当な質問を、IR窓口へ橋渡しするため記録する（痛み②の給餌口）。
    個人情報は保存しない。

    Args:
        question: 投資家の質問（PIIを含めない）。
        reason: 'out_of_corpus' | 'unknown' 等。

    Returns:
        {'escalated': True} と、ユーザーに返す丁寧な案内文。
    """
    company_id = store.resolve_company_id(company_ticker)
    try:
        store.insert_escalation(company_id, question, reason, "escalated")
    except Exception as e:
        return {"escalated": False, "error": str(e),
                "message": "申し訳ありません、ただいまお取り次ぎに失敗しました。"}
    return {
        "escalated": True,
        "message": "この質問は開示資料に見当たりませんでした。IR窓口にお取り次ぎします。",
    }
