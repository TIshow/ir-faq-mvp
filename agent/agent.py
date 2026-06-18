"""
IR Agent 本体（ADK）＋ AgentResponse 合成 ＋ ストリーミング。

設計の肝（数値はLLMの文章を経由させない）:
  - LLM は answer_prose（語り）とツール選択のみ担う。
  - fact_cards は get_financial_facts のツール戻り値から「コードで」合成する。
  - citations は search_disclosures のツール戻り値から合成する。
  - scope_status は入口分類(scope.classify_scope) と escalate_to_ir 呼び出しから決める。

多層防御:
  [1] 入口: classify_scope で明白な助言/予測/未開示を短絡拒否
  [2] 生成: 鉄則プロンプト＋ツール接地（戻り値以外を語らせない）
  [3] 出口: compose 時に出典欠落カード除去・scope確定

注: ADK 2.x のイベント/型は環境で要確認。アクセスは防御的に実装。
"""

from __future__ import annotations

from typing import Any, AsyncIterator

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from . import config, prompt
from .scope import classify_scope
from .tools import escalate_to_ir, get_financial_facts, search_disclosures

APP_NAME = "ir-agent"
COMPANY_NAME = "株式会社ヴィス"  # PoC。本番はテナント設定から注入。
COMPANY_TICKER = "5071"


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
            lines.append(f"- 実績の期間ラベル(periods, basis='actual'): {', '.join(s['periods_actual'])}（最新＝最も大きい年度＝『前期/直近』）")
        if s.get("periods_forecast"):
            lines.append(f"- 会社予想の期間ラベル(periods, basis='forecast'): {', '.join(s['periods_forecast'])}")
        if metrics:
            lines.append(f"- 指標キー(metric_keys): {metrics}")
        lines.append("- 営業利益率は metric_keys に 'operating_margin' を指定（コードで計算）。")
        return "\n".join(lines)
    except Exception:
        return ""


# ADKエージェント（ツールは関数の型ヒント＋docstringから自動ラップ）
root_agent = Agent(
    name="ir_agent",
    model=config.MODEL_NAME,
    instruction=prompt.build_instruction(COMPANY_NAME, _build_data_hint(COMPANY_TICKER)),
    tools=[get_financial_facts, search_disclosures, escalate_to_ir],
)

_session_service = InMemorySessionService()


# --------------------------------------------------------------------------- #
# イベントからの抽出（ADKイベントを防御的に読む）
# --------------------------------------------------------------------------- #
def _iter_parts(event: Any):
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) if content else None
    return parts or []


def _extract_text(event: Any) -> str:
    out = []
    for part in _iter_parts(event):
        text = getattr(part, "text", None)
        if text:
            out.append(text)
    return "".join(out)


def _extract_tool_responses(event: Any) -> list[tuple[str, dict[str, Any]]]:
    """(tool_name, response_dict) のリストを返す。"""
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
        out.append({"doc": c.get("doc"), "page": c.get("page"),
                    "url": c.get("url"), "quote": c.get("quote")})
    return out


def _compose(prose: str, fact_cards: list[dict[str, Any]], citations: list[dict[str, Any]],
             escalated: bool) -> dict[str, Any]:
    # [3] 出口チェック: 出典の無いカードは捨てる
    fact_cards = [c for c in fact_cards if (c.get("source") or {}).get("doc")]
    citations = _dedup_citations(citations)

    if escalated:
        scope_status, scope_reason = "escalated", "out_of_corpus"
    elif not fact_cards and not citations and not prose.strip():
        scope_status, scope_reason = "escalated", "unknown"
    else:
        scope_status, scope_reason = "answered", None

    return {
        "answer_prose": prose.strip(),
        "fact_cards": fact_cards,
        "citations": citations,
        "scope_status": scope_status,
        "scope_reason": scope_reason,
    }


def _refusal_response(decision) -> dict[str, Any]:
    return {
        "answer_prose": decision.message or "お答えできません。",
        "fact_cards": [],
        "citations": [],
        "scope_status": decision.status,   # 'refused'
        "scope_reason": decision.reason,
    }


# --------------------------------------------------------------------------- #
# 実行（ストリーミング / 一括）
# --------------------------------------------------------------------------- #
async def run_agent_stream(query: str, company_ticker: str = "5071",
                           user_id: str = "anon", session_id: str = "s1") -> AsyncIterator[dict[str, Any]]:
    """
    yield:
      {"type":"prose_delta","text": "..."}   # 逐次（体感速度=Q4）
      {"type":"final","response": AgentResponse}
    """
    # [1] 入口スコープ分類で明白な拒否を短絡（エージェント呼び出し不要）
    decision = classify_scope(query)
    if decision.status != "answered":
        yield {"type": "prose_delta", "text": decision.message or ""}
        yield {"type": "final", "response": _refusal_response(decision)}
        return

    # セッションは get-or-create（同一IDの再作成で落とさない）
    existing = None
    try:
        existing = await _session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        existing = None
    if existing is None:
        try:
            await _session_service.create_session(
                app_name=APP_NAME, user_id=user_id, session_id=session_id
            )
        except Exception:
            pass  # 競合等で既に作成済みなら無視
    runner = Runner(agent=root_agent, app_name=APP_NAME, session_service=_session_service)

    prose_parts: list[str] = []
    fact_cards: list[dict[str, Any]] = []
    citations: list[dict[str, Any]] = []
    escalated = False

    message = types.Content(role="user", parts=[types.Part(text=query)])

    async for event in runner.run_async(user_id=user_id, session_id=session_id, new_message=message):
        # ツール戻り値を捕捉（数値・引用はここから合成）
        for name, resp in _extract_tool_responses(event):
            if name == "get_financial_facts":
                fact_cards.extend(resp.get("facts", []))
            elif name == "search_disclosures":
                citations.extend(resp.get("passages", []))
            elif name == "escalate_to_ir":
                escalated = escalated or bool(resp.get("escalated"))

        # モデルの語りを逐次ストリーム
        text = _extract_text(event)
        if text:
            prose_parts.append(text)
            yield {"type": "prose_delta", "text": text}

    yield {"type": "final",
           "response": _compose("".join(prose_parts), fact_cards, citations, escalated)}


async def run_agent(query: str, company_ticker: str = "5071") -> dict[str, Any]:
    """非ストリーミング（評価ハーネス eval_harness.call_agent から利用）。"""
    final: dict[str, Any] = {}
    async for chunk in run_agent_stream(query, company_ticker):
        if chunk["type"] == "final":
            final = chunk["response"]
    return final
