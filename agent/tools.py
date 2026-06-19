"""
IR Agent のツール（ADKが function tool として自動ラップ）。

マルチテナント: 対象企業は **セッション状態 `state["company"]`**（ticker / name / datastore_id）から
取得する（ハードコードしない）。企業コンテキストは run_agent_stream がリクエストごとに seed する。

- get_financial_facts: 層1（決定論DB）。YoY・利益率はここでコード計算。
- search_disclosures: 層2（その企業の Discovery Engine データストア）。引用付きパッセージ。
- escalate_to_ir: 拒否・不明をIRへ記録（痛み②）。

ツールは FactCard / Citation 形（agent-types.ts と一致）の dict を返す。
fact_cards の最終合成は agent.py がツール戻り値を捕捉して行う（数値はLLMの文章を経由させない）。
"""

from __future__ import annotations

import html
import re
from typing import Any

from google.adk.tools import ToolContext

from . import config, store

# DB に無く、構成要素から計算する派生指標: key -> (分子, 分母, 表示名)
DERIVED_METRICS: dict[str, tuple[str, str, str]] = {
    "operating_margin": ("operating_profit", "revenue", "営業利益率"),
    "gross_margin": ("gross_profit", "revenue", "売上総利益率"),
    "net_margin": ("net_income", "revenue", "当期純利益率"),
}


def _company(tool_context: ToolContext | None) -> dict[str, Any]:
    """セッション状態から対象企業 {ticker, name, datastore_id} を取得。"""
    state = getattr(tool_context, "state", None) or {}
    try:
        return dict(state.get("company") or {})
    except Exception:
        return {}


def _fmt_value(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value:.1f}%"
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
    def keyf(p: str):
        m = re.match(r"(\d{4})(?:Q(\d))?", p)
        if not m:
            return (0, 0)
        return (int(m.group(1)), int(m.group(2) or 9))

    return max(periods, key=keyf) if periods else None


def get_financial_facts(
    metric_keys: list[str],
    periods: list[str],
    consolidated: bool = True,
    basis: str = "actual",
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """
    対象企業（セッションで指定）の財務数値を取得する。営業利益率などの派生指標はコードで計算。
    必ず開示済み・検証済みのファクトのみを返し、各値に出典を付ける。

    Args:
        metric_keys: 指標キー（例 ['operating_profit','revenue','operating_margin',
            'segment.office.revenue']）。
        periods: 期間ラベル（例 ['2025FY','2024FY']）。前年比は2期以上を渡す。
        consolidated: 連結=True / 単体=False。
        basis: 'actual'（実績） / 'forecast'（会社予想）。

    Returns:
        {'facts': [FactCard...]}。対象企業のデータが無ければ facts は空。
    """
    company = _company(tool_context)
    ticker = company.get("ticker")
    if not ticker:
        return {"facts": [], "note": "対象企業が指定されていません"}

    company_id = store.resolve_company_id(ticker)
    if company_id is None:
        return {"facts": [], "note": f"企業(ticker={ticker})のデータがありません"}

    requested = list(metric_keys)
    base_keys = [k for k in requested if k not in DERIVED_METRICS]
    derived_keys = [k for k in requested if k in DERIVED_METRICS]

    needed = set(base_keys)
    for dk in derived_keys:
        num, den, _ = DERIVED_METRICS[dk]
        needed.update([num, den])

    rows = store.query_facts(company_id, sorted(needed), periods, consolidated, basis)

    by_kp: dict[tuple[str, str], dict[str, Any]] = {
        (r["metric_key"], r["period_label"]): r for r in rows
    }
    latest = _latest_period(periods)
    cards: list[dict[str, Any]] = []

    for k in base_keys:
        for p in periods:
            row = by_kp.get((k, p))
            if not row:
                continue
            yoy = None
            if p == latest:
                prevs = [pp for pp in periods if pp != latest]
                prev_p = _latest_period(prevs) if prevs else None
                prev_row = by_kp.get((k, prev_p)) if prev_p else None
                if prev_row:
                    yoy = _fmt_yoy(float(row["value_numeric"]), float(prev_row["value_numeric"]))
            cards.append(_to_card(row, yoy))

    for dk in derived_keys:
        num_k, den_k, label = DERIVED_METRICS[dk]
        for p in periods:
            num_row = by_kp.get((num_k, p))
            den_row = by_kp.get((den_k, p))
            if not num_row or not den_row or float(den_row["value_numeric"]) == 0:
                continue
            margin = float(num_row["value_numeric"]) / float(den_row["value_numeric"]) * 100.0
            cards.append(
                {
                    "metric": label,
                    "metricKey": dk,
                    "period": p,
                    "value": _fmt_value(margin, "%"),
                    "valueNumeric": round(margin, 4),
                    "unit": "%",
                    "yoy": None,
                    "consolidated": consolidated,
                    "basis": "forecast" if basis == "forecast" else "actual",
                    "source": _to_card(num_row)["source"],
                }
            )

    return {"facts": cards}


def _clean(text: str) -> str:
    text = re.sub(r"<[^>]*>", "", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def search_disclosures(query: str, tool_context: ToolContext = None) -> dict[str, Any]:
    """
    対象企業（セッションで指定）の開示資料から、質問に関連する定性的記述を引用付きで検索する。
    「なぜ」「背景」「戦略」等の説明に使う。数値の根拠には get_financial_facts を使うこと。

    Returns:
        {'passages': [{'text','doc','page','url','quote'}...]}
    """
    company = _company(tool_context)
    datastore_id = company.get("datastore_id")
    if not datastore_id:
        return {"passages": [], "note": "対象企業の開示データストアが指定されていません"}

    from google.cloud import discoveryengine_v1 as de

    client = de.SearchServiceClient()
    serving_config = config.datastore_serving_config(datastore_id)

    request = de.SearchRequest(
        serving_config=serving_config,
        query=query,
        page_size=config.MAX_DISCLOSURE_RESULTS,
        # 注: このデータストアは chunking config のため extractive_content_spec は不可。
        # snippet のみ指定（FAQの question/answer は structData から取得する）。
        content_search_spec=de.SearchRequest.ContentSearchSpec(
            snippet_spec=de.SearchRequest.ContentSearchSpec.SnippetSpec(return_snippet=True),
        ),
        query_expansion_spec=de.SearchRequest.QueryExpansionSpec(
            condition=de.SearchRequest.QueryExpansionSpec.Condition.AUTO,
        ),
        language_code="ja",
    )

    def _g(obj, key):  # proto MapComposite / dict 両対応の get
        try:
            return obj.get(key)
        except Exception:
            return None

    passages: list[dict[str, Any]] = []
    try:
        response = client.search(request)
        for result in response.results:
            doc = result.document
            sd = doc.struct_data  # 構造化（FAQ: question/answer）
            dd = doc.derived_struct_data  # 非構造（PDF: title/link/extractive/snippet）
            title = _g(dd, "title") or "開示資料"
            link = _g(dd, "link")

            # 1) 構造化FAQ（IR承認のQ&A）を最優先でパッセージ化
            answer = _g(sd, "answer")
            if answer:
                q = _g(sd, "question") or ""
                a = _clean(str(answer))
                if a:
                    passages.append(
                        {
                            "text": a,
                            "doc": "IR想定問答（FAQ）" + (f"：{q}" if q else ""),
                            "page": None,
                            "url": link,
                            "quote": _clean(f"Q: {q} / A: {answer}")[:300],
                        }
                    )
                continue

            # 2) 非構造（PDF）: extractive answers / snippets
            chunks: list[tuple[str, int | None]] = []
            for ea in _g(dd, "extractive_answers") or []:
                content = _g(ea, "content")
                if content:
                    page = _g(ea, "pageNumber") or _g(ea, "page_number")
                    chunks.append((str(content), int(page) if page else None))
            for sn in _g(dd, "snippets") or []:
                snip = _g(sn, "snippet")
                if snip:
                    chunks.append((str(snip), None))
            for content, page in chunks:
                cleaned = _clean(content)
                if len(cleaned) > 10:
                    passages.append(
                        {
                            "text": cleaned,
                            "doc": title,
                            "page": page,
                            "url": link,
                            "quote": cleaned[:300],
                        }
                    )
    except Exception as e:
        return {"passages": [], "error": str(e)}

    return {"passages": passages}


def escalate_to_ir(
    question: str, reason: str = "out_of_corpus", tool_context: ToolContext = None
) -> dict[str, Any]:
    """
    開示資料で答えられない正当な質問を、IR窓口へ橋渡しするため記録する（痛み②）。PII不可。

    Args:
        question: 投資家の質問（PIIを含めない）。
        reason: 'out_of_corpus' | 'unknown' 等。
    """
    company = _company(tool_context)
    ticker = company.get("ticker")
    company_id = store.resolve_company_id(ticker) if ticker else None
    try:
        store.insert_escalation(company_id, question, reason, "escalated")
    except Exception as e:
        return {
            "escalated": False,
            "error": str(e),
            "message": "申し訳ありません、ただいまお取り次ぎに失敗しました。",
        }
    return {
        "escalated": True,
        "message": "この質問は開示資料に見当たりませんでした。IR窓口にお取り次ぎします。",
    }
