"""
IR Agent 本体（ADK）＋ AgentResponse 合成 ＋ ストリーミング（マルチテナント）。

対象企業はハードコードしない。リクエストごとに company={ticker,name,datastore_id} を受け取り:
  - システムプロンプトと利用可能データのヒントを company から構築
  - セッション状態 state["company"] に seed → ツールがそこから対象企業を読む
  - セッションIDに ticker を含め、企業切替で状態が混ざらないようにする

設計の肝（数値はLLMの文章を経由させない）:
  - fact_cards は get_financial_facts のツール戻り値から「コードで」合成
  - citations は search_disclosures のツール戻り値から合成
  - scope_status は入口分類(scope) と escalate_to_ir 呼び出しから決める
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from . import config, prompt
from .analytics import log_interaction
from .scope import classify_scope
from .suggest import build_suggestions
from .tools import escalate_to_ir, get_financial_facts, search_disclosures

APP_NAME = "ir-agent"

_session_service = InMemorySessionService()
_TOOLS = [get_financial_facts, search_disclosures, escalate_to_ir]


def _build_data_hint(ticker: str) -> str:
    """利用可能な期間・指標をプロンプトに注入（エージェントの引数ズレ防止）。"""
    try:
        from . import store

        if not hasattr(store, "summary"):
            return ""
        s = store.summary(ticker)
        metrics = "、".join(f"{label}={key}" for key, label in s.get("metrics", {}).items())
        lines = []
        if s.get("periods_actual"):
            lines.append(
                f"- 実績の期間ラベル(periods, basis='actual'): {', '.join(s['periods_actual'])}（最新＝最も大きい年度＝『前期/直近』）"
            )
        if s.get("periods_forecast"):
            lines.append(
                f"- 会社予想の期間ラベル(periods, basis='forecast'): {', '.join(s['periods_forecast'])}"
            )
        if metrics:
            lines.append(f"- 指標キー(metric_keys): {metrics}")
        if not lines:
            return "- この企業の構造化財務データはまだ登録されていません（数値が無ければ無理に答えず escalate_to_ir）。"
        lines.append("- 営業利益率は metric_keys に 'operating_margin' を指定（コードで計算）。")
        return "\n".join(lines)
    except Exception:
        return ""


def _make_agent(company_name: str, ticker: str) -> Agent:
    """対象企業向けのエージェントを構築（プロンプトに企業名＋利用可能データを注入）。"""
    return Agent(
        name="ir_agent",
        model=config.MODEL_NAME,
        instruction=prompt.build_instruction(company_name, _build_data_hint(ticker)),
        tools=_TOOLS,
    )


# ADK CLI（adk web/run）用の汎用フォールバック。実サーブは run_agent_stream が企業別に構築。
root_agent = Agent(
    name="ir_agent",
    model=config.MODEL_NAME,
    instruction=prompt.build_instruction("対象企業", ""),
    tools=_TOOLS,
)


# --------------------------------------------------------------------------- #
# イベント抽出
# --------------------------------------------------------------------------- #
def _iter_parts(event: Any):
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) if content else None
    return parts or []


def _extract_text(event: Any) -> str:
    return "".join(getattr(p, "text", None) or "" for p in _iter_parts(event))


def _extract_tool_responses(event: Any) -> list[tuple[str, dict[str, Any]]]:
    results: list[tuple[str, dict[str, Any]]] = []
    for part in _iter_parts(event):
        fr = getattr(part, "function_response", None)
        if fr is not None:
            name = getattr(fr, "name", "") or ""
            resp = getattr(fr, "response", None) or {}
            if isinstance(resp, dict):
                results.append((name, resp))
    return results


# --------------------------------------------------------------------------- #
# 合成
# --------------------------------------------------------------------------- #
def _dedup_citations(cites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen, out = set(), []
    for c in cites:
        key = (c.get("doc"), c.get("page"))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "doc": c.get("doc"),
                "page": c.get("page"),
                "url": c.get("url"),
                "quote": c.get("quote"),
            }
        )
    return out


def _compose(
    prose: str,
    fact_cards: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    escalated: bool,
    suggestions: list[str],
) -> dict[str, Any]:
    fact_cards = [c for c in fact_cards if (c.get("source") or {}).get("doc")]
    citations = _dedup_citations(citations)
    if escalated:
        scope_status, scope_reason = "escalated", "out_of_corpus"
    elif not fact_cards and not citations:
        # 接地ゼロ（数値カードも引用も無い）＝開示資料で答えられていない。
        # LLM が escalate_to_ir を呼ばず散文で謝っただけのケースもここで拾い、
        # 「IR窓口へ」CTA を必ず出す（行き止まりにしない／answered 誤ラベルを防ぐ）。
        scope_status, scope_reason = "escalated", "out_of_corpus"
    else:
        scope_status, scope_reason = "answered", None

    # エスカレーション＝未回答。答えを支えない数値カード/参考資料は出さない（誤誘導を防ぐ）。
    if scope_status == "escalated":
        fact_cards, citations = [], []

    return {
        "answer_prose": prose.strip(),
        "fact_cards": fact_cards,
        "citations": citations,
        "scope_status": scope_status,
        "scope_reason": scope_reason,
        "suggestions": suggestions,
    }


def _refusal_response(decision, suggestions: list[str]) -> dict[str, Any]:
    return {
        "answer_prose": decision.message or "お答えできません。",
        "fact_cards": [],
        "citations": [],
        "scope_status": decision.status,
        "scope_reason": decision.reason,
        "suggestions": suggestions,
    }


# --------------------------------------------------------------------------- #
# 実行
# --------------------------------------------------------------------------- #
async def run_agent_stream(
    query: str, company: dict[str, Any], user_id: str = "anon", session_id: str = "s1"
) -> AsyncIterator[dict[str, Any]]:
    """
    company = {"ticker","name","datastore_id"}。
    yield: {"type":"prose_delta","text":...} / {"type":"final","response": AgentResponse}
    """
    ticker = str(company.get("ticker") or "")
    name = company.get("name") or "対象企業"

    # 次の質問サジェスト（A-lite: 開示データから決定論生成。拒否時も「行き止まり」にしない）
    suggestions = build_suggestions(ticker, exclude=query)

    decision = classify_scope(query)
    if decision.status != "answered":
        log_interaction(ticker, query, decision.status, decision.reason, 0, 0)
        yield {"type": "prose_delta", "text": decision.message or ""}
        yield {"type": "final", "response": _refusal_response(decision, suggestions)}
        return

    # 企業ごとにセッションを分離し、状態に企業コンテキストを seed
    sid = f"{session_id}:{ticker}"
    existing = None
    try:
        existing = await _session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=sid
        )
    except Exception:
        existing = None
    if existing is None:
        try:
            await _session_service.create_session(
                app_name=APP_NAME,
                user_id=user_id,
                session_id=sid,
                state={
                    "company": {
                        "ticker": ticker,
                        "name": name,
                        "datastore_id": company.get("datastore_id"),
                    }
                },
            )
        except Exception:
            pass

    agent = _make_agent(name, ticker)
    runner = Runner(agent=agent, app_name=APP_NAME, session_service=_session_service)

    prose_parts: list[str] = []
    fact_cards: list[dict[str, Any]] = []
    citations: list[dict[str, Any]] = []
    escalated = False

    message = types.Content(role="user", parts=[types.Part(text=query)])
    async for event in runner.run_async(user_id=user_id, session_id=sid, new_message=message):
        for tname, resp in _extract_tool_responses(event):
            if tname == "get_financial_facts":
                fact_cards.extend(resp.get("facts", []))
            elif tname == "search_disclosures":
                citations.extend(resp.get("passages", []))
            elif tname == "escalate_to_ir":
                escalated = escalated or bool(resp.get("escalated"))
        text = _extract_text(event)
        if text:
            prose_parts.append(text)
            yield {"type": "prose_delta", "text": text}

    final = _compose("".join(prose_parts), fact_cards, citations, escalated, suggestions)
    log_interaction(
        ticker,
        query,
        final["scope_status"],
        final.get("scope_reason"),
        len(final["fact_cards"]),
        len(final["citations"]),
    )
    yield {"type": "final", "response": final}


async def run_agent(query: str, company: dict[str, Any]) -> dict[str, Any]:
    """非ストリーミング（評価ハーネス等）。company={ticker,name,datastore_id}。"""
    final: dict[str, Any] = {}
    async for chunk in run_agent_stream(query, company):
        if chunk["type"] == "final":
            final = chunk["response"]
    return final
