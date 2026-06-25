"""Grounded Synthesis（接地した統合合成）パイプライン。

従来の「LLMがツールを選ぶ agentic ループ」を、決定論的な retrieve → LLM合成 → 接地 に置換する
（金融コパイロット型）。狙い:
  - 横断質問の統合合成（数値＋定性＋FAQを1回答に）
  - ツール選択の脆さを排除（retrieve は常に全部・決定論）
  - answerability 判定（制約「数値で」「10年分」を満たせなければ正直にエスカレーション）
  - 数値の正確性は維持（LLMは『どの指標を見せるか』だけ選ぶ。値はコードが facts から埋める）

config.ANSWER_MODE == 'synthesis' のときに agent.run_agent_stream から呼ばれる。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import config, store
from .tools import build_financial_facts, search_disclosures

_log = logging.getLogger("ir-agent.synth")
_client = None


def _genai_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(
            vertexai=True, project=config.PROJECT_ID, location=config.VERTEX_LOCATION
        )
    return _client


class _Ctx:
    """search_disclosures に企業コンテキストを渡すための最小オブジェクト。"""

    def __init__(self, company: dict[str, Any]):
        self.state = {"company": company}


PROMPT = """あなたは {company_name} の「開示済みIR情報のみ」を案内する広報アシスタントです。
以下の「利用可能な財務数値」と「開示資料の抜粋（FAQ含む）」**だけ**を根拠に、質問に答えてください。

# 鉄則（必ず守る）
- 開示済みの事実のみ。資料・数値に無いことは推測・捏造しない。
- 投資助言・将来予測・未開示情報は述べない（開示済みの「会社予想」は『会社予想』と明示すれば可）。
- 数値は本文(answer_prose)に書かない。relevant_metrics で**指標キーを選ぶだけ**（値はシステムがカード表示する）。
- 質問の制約（例「数値で」「10年分」「セグメント比較」）を、利用可能なデータで**満たせない場合は can_answer=false** にし、
  escalate_reason に正直な理由を書く（例「数値の開示は直近2期のみで長期推移は未開示」）。
- answer_prose は地の文2〜3文。表・箇条書き・金額/％/期間ラベルを含めない。傾向・理由・文脈のみ。

# can_answer の判断（重要）
- 質問が「利用可能な財務数値」にある指標（売上高/売上総利益/営業利益/経常利益/純利益/EPS/配当/セグメント/利益率 等）を
  尋ねていて、その metric_key が下のリストにある → **必ず can_answer=true** とし、relevant_metrics にその metric_key を入れる。
  **数値が利用可能なのにエスカレーションしない。**
- 用語の質問（「〜とは？」）→ can_answer=true。定義を述べ、relevant_metrics にその指標を入れて実例として接地する。
- **can_answer=false にするのは次だけ**：利用可能リストに無い指標（例: ROE）／長期・過去◯年の推移が未開示／
  未開示の重要情報／将来予測。質問の制約（「数値で」等）を利用可能データで満たせない場合も false。

# 質問
{query}

# 利用可能な財務数値（この指標キーだけ relevant_metrics に使える）
{facts_context}

# 開示資料の抜粋（FAQ含む・番号付き。used_citations にこの番号を使う）
{passages_context}

# 出力（JSONのみ・前後に文を付けない）
{{
  "can_answer": true/false,
  "answer_prose": "地の文2〜3文（数値・表なし）",
  "relevant_metrics": ["回答に関連する metric_key。定性のみ・該当無しなら空配列"],
  "used_citations": [使った抜粋の番号(整数)],
  "escalate_reason": "can_answer=false の時の正直な理由（true の時は空文字）"
}}
"""


def _facts_context(ticker: str) -> tuple[str, list[str], list[str]]:
    """利用可能な指標キー・期間を可読テキスト化。(context, periods_actual, periods_forecast)。"""
    s = store.summary(ticker) if hasattr(store, "summary") else {}
    pa = s.get("periods_actual", [])
    pf = s.get("periods_forecast", [])
    metrics: dict[str, str] = s.get("metrics", {})
    if not metrics:
        return ("（この企業の構造化財務数値は未登録）", pa, pf)
    lines = [f"- {k} = {label}" for k, label in metrics.items()]
    # 派生指標も選べることを明示
    lines.append("- operating_margin = 営業利益率（コード計算）")
    ctx = (
        f"実績の期間: {', '.join(pa) or 'なし'} / 会社予想の期間: {', '.join(pf) or 'なし'}\n"
        "指標キー:\n" + "\n".join(lines)
    )
    return (ctx, pa, pf)


def synthesize(query: str, company: dict[str, Any]) -> dict[str, Any]:
    """retrieve → 合成 → 接地。AgentResponse（suggestions 抜き）を返す。失敗時は escalate。"""
    ticker = str(company.get("ticker") or "")
    name = company.get("name") or "対象企業"

    # 1) RETRIEVE（決定論）
    facts_ctx, pa, pf = _facts_context(ticker)
    try:
        passages = search_disclosures(query, _Ctx(company)).get("passages", [])
    except Exception as e:
        _log.warning("retrieve(search) 失敗: %s", e)
        passages = []
    passages_ctx = (
        "\n".join(
            f"[{i}] doc={p.get('doc')} / {str(p.get('text', ''))[:400]}"
            for i, p in enumerate(passages)
        )
        or "（該当する開示抜粋なし）"
    )

    # 2) SYNTHESIZE + ANSWERABILITY（LLM・構造化JSON）
    prompt = PROMPT.format(
        company_name=name, query=query, facts_context=facts_ctx, passages_context=passages_ctx
    )
    try:
        from google.genai import types

        resp = _genai_client().models.generate_content(
            model=config.MODEL_NAME,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json", temperature=0
            ),
        )
        data = json.loads(resp.text)
    except Exception as e:
        _log.warning("synthesize(LLM) 失敗: %s", e)
        return _escalate("ただいま回答を生成できませんでした。")

    can_answer = bool(data.get("can_answer"))
    prose = str(data.get("answer_prose") or "").strip()
    rel_metrics = [m for m in (data.get("relevant_metrics") or []) if isinstance(m, str)]
    used = [i for i in (data.get("used_citations") or []) if isinstance(i, int)]
    escalate_reason = str(data.get("escalate_reason") or "").strip()

    if not can_answer:
        return _escalate(escalate_reason or "開示資料では確認できませんでした。")

    # 3) GROUND（決定論：値は facts から埋める。LLMは指標キーを選んだだけ）
    fact_cards: list[dict[str, Any]] = []
    if rel_metrics:
        company_id = store.resolve_company_id(ticker)
        if company_id is not None:
            if pa:
                fact_cards += build_financial_facts(company_id, rel_metrics, pa, True, "actual")
            if pf:
                fact_cards += build_financial_facts(company_id, rel_metrics, pf, True, "forecast")

    citations = [
        {
            "doc": passages[i].get("doc"),
            "page": passages[i].get("page"),
            "url": passages[i].get("url"),
            "quote": passages[i].get("quote"),
        }
        for i in used
        if 0 <= i < len(passages)
    ]

    # 接地ゼロ（数値も引用も無い）かつ prose だけ＝実質未回答 → エスカレーション
    if not fact_cards and not citations:
        return _escalate(escalate_reason or "開示資料では確認できませんでした。")

    return {
        "answer_prose": prose,
        "fact_cards": fact_cards,
        "citations": citations,
        "scope_status": "answered",
        "scope_reason": None,
    }


def _escalate(reason: str) -> dict[str, Any]:
    msg = f"{reason} 恐れ入りますが、IR窓口へお問い合わせください。"
    return {
        "answer_prose": msg,
        "fact_cards": [],
        "citations": [],
        "scope_status": "escalated",
        "scope_reason": "out_of_corpus",
    }
