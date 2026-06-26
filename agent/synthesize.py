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
import re
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


PROMPT = """あなたは {company_name} の開示情報をもとに、個人投資家へ深い洞察を届ける**IRアナリスト**です。
あなたの価値は、数値の列挙やFAQの引き写しではなく、**数値（財務データ）と定性情報（開示資料）を統合した
『分析・説明』の生成**にあります。'何が起きたか'だけでなく'なぜか・何を意味するか・どこが注目点か'まで、
**開示済みの事実の範囲で**語ってください。

# 鉄則（必ず守る）
- 開示済みの事実のみ。下記「財務数値」と「開示資料の抜粋」に無い数字・事実は作らない・推測しない。
- 投資助言・推奨（買う/売る/割安等）や将来予測はしない。開示済みの「会社予想」は『会社予想』と明示すれば述べてよい。
- 未開示の重要情報は述べない（フェアディスクロージャー遵守）。
- **数値は下の「財務数値」（実数・前年比・利益率・構成比は計算済み）と開示抜粋に書かれた範囲だけで使う。**
  自分で新たな割り算・掛け算をして数字を作らない。表に無い比率は「開示資料に記載はありません」と述べる。
- FAQや抜粋を**そのまま引き写さない**。複数の情報源を統合し、自分の言葉で分析・説明する。

# 回答の作り方（生成IR）
- 質問に直接答えたうえで、背景・ドライバー（牽引したセグメント等）・前年比較・含意まで踏み込む。
- 傾向だけでなく**具体的な数値・変化率を交えて**説得力を持たせてよい（数値はカードと出典が裏取りする）。
- 質問に応じ Markdown の**表や箇条書き**で構造化してよい。表の数字も上の「財務数値」の範囲のみ。
- 長さは質問に応じて調整（定型の事実確認は簡潔に、分析・比較質問は厚く）。免責の繰り返しや冗長な前置きはしない。
- relevant_metrics には、回答で触れた主要指標の metric_key を入れる（散文の数値に対応するカードを表示するため）。

# can_answer の判断（上から順に適用）
- **最優先**: 「開示資料の抜粋（FAQ含む）」に質問へ**直接答える**記述があれば → **必ず can_answer=true**。
  used_citations にその番号を入れる。構造化数値に無い指標（例: ROE）でもFAQ/抜粋に答えがあれば true
  （relevant_metrics は該当する構造化指標が無ければ空配列でよい＝引用だけで接地）。
- 「財務数値」にある指標を尋ねている → **必ず can_answer=true**。relevant_metrics にその metric_key を入れる。
  **数値が利用可能なのにエスカレーションしない。**
- 用語の質問（「〜とは？」）→ can_answer=true。定義＋この会社の実数で例示（relevant_metrics に指標を入れる）。
- **can_answer=false にするのは**：財務数値にも開示抜粋(FAQ含む)にも答えが無い指標／長期・過去◯年の推移が未開示／
  未開示の重要情報／将来予測。質問の制約（「数値で」等）を利用可能データで満たせない場合も false。
  **ただし上の「最優先」に該当するなら必ず true。**

# 質問
{query}

# 財務数値（{company_name}・連結・検証済み実数。前年比・利益率・構成比は計算済み＝分析に自由に使ってよい）
{facts_context}

# 開示資料の抜粋（FAQ含む・番号付き。used_citations にこの番号(整数)を使う）
{passages_context}

# 出力（JSONのみ・前後に文を付けない）
{{
  "can_answer": true/false,
  "answer_prose": "生成IRの本文。提供データの範囲で、数値・表・箇条書きを適切に使い分析・説明を厚く書く",
  "relevant_metrics": ["カード表示する metric_key。定性のみ・該当無しなら空配列"],
  "used_citations": [使った抜粋の番号(整数)],
  "escalate_reason": "can_answer=false の時の正直な理由（true の時は空文字）"
}}
"""


def _fmt(value: float, unit: str) -> str:
    """実数を表示用に整形（％はそのまま、それ以外は3桁区切り＋単位）。"""
    if unit == "%":
        return f"{value:.1f}%"
    return f"{int(round(value)):,}{unit}"


def _yoy_pct(curr: float, prev: float) -> str:
    """前年比（%）。コードで計算してLLMに渡す＝LLMに暗算させない。"""
    if prev == 0:
        return "—"
    p = (curr - prev) / abs(prev) * 100.0
    return f"{'+' if p >= 0 else '-'}{abs(p):.1f}%"


def _year_key(period: str) -> int:
    m = re.match(r"(\d{4})", period)
    return int(m.group(1)) if m else 0


def _facts_context(ticker: str) -> tuple[str, list[str], list[str]]:
    """利用可能な財務数値を『実数＋前年比＋利益率＋構成比つきの分析用データシート』に整形する。
    LLMはこれを読んで生成IR（分析・説明）を書く。前年比・利益率・構成比は**コードで計算**して渡し、
    LLMに暗算させない（算数事故を構造的に防ぐ）。数値カードは別途 build_financial_facts が作る。
    返り値: (context, periods_actual, periods_forecast)。"""
    s = store.summary(ticker) if hasattr(store, "summary") else {}
    pa = sorted(s.get("periods_actual", []), key=_year_key)
    pf = sorted(s.get("periods_forecast", []), key=_year_key)
    metrics: dict[str, str] = s.get("metrics", {})
    if not metrics:
        return ("（この企業の構造化財務数値は未登録）", pa, pf)

    cid = store.resolve_company_id(ticker)
    if cid is None:
        return ("（この企業の構造化財務数値は未登録）", pa, pf)

    all_keys = list(metrics.keys())
    rows_a = store.query_facts(cid, all_keys, pa, True, "actual") if pa else []
    rows_f = store.query_facts(cid, all_keys, pf, True, "forecast") if pf else []
    A = {(r["metric_key"], r["period_label"]): r for r in rows_a}
    F = {(r["metric_key"], r["period_label"]): r for r in rows_f}

    headline = [k for k in all_keys if not k.startswith("segment.")]
    latest = pa[-1] if pa else None
    prev = pa[-2] if len(pa) >= 2 else None
    lines: list[str] = []

    # --- 全社サマリー（実績）: 各期の実数 ＋ 最新期の前年比 ---
    lines.append(f"## 全社サマリー（連結・実績） 期間: {', '.join(pa) or 'なし'}")
    for k in headline:
        cells = []
        for p in pa:
            r = A.get((k, p))
            cells.append(f"{p}={_fmt(float(r['value_numeric']), r['unit'])}" if r else f"{p}=—")
        yoy = ""
        if latest and prev:
            rc, rp = A.get((k, latest)), A.get((k, prev))
            if rc and rp:
                yoy = f"（前年比 {_yoy_pct(float(rc['value_numeric']), float(rp['value_numeric']))}）"
        lines.append(f"- {metrics[k]} ({k}): {' '.join(cells)}{yoy}")

    # --- 営業利益率（コード計算）を全期分 ---
    if "revenue" in headline and "operating_profit" in headline:
        cells = []
        for p in pa:
            rr, ro = A.get(("revenue", p)), A.get(("operating_profit", p))
            if rr and ro and float(rr["value_numeric"]) != 0:
                m = float(ro["value_numeric"]) / float(rr["value_numeric"]) * 100.0
                cells.append(f"{p}={m:.1f}%")
            else:
                cells.append(f"{p}=—")
        lines.append(f"- 営業利益率 (operating_margin・コード計算): {' '.join(cells)}")

    # --- セグメント別（最新期）: 売上・前年比・全社構成比・営業利益 ---
    segs: dict[str, dict[str, str]] = {}
    for k in all_keys:
        if k.startswith("segment."):
            _, seg, met = k.split(".", 2)
            segs.setdefault(seg, {})[met] = k
    if segs and latest:
        total_rev = A.get(("revenue", latest))
        total_rev_v = float(total_rev["value_numeric"]) if total_rev else 0.0
        lines.append(f"\n## セグメント別（連結・実績） 最新期: {latest}")
        for seg, mm in segs.items():
            rev_k, op_k = mm.get("revenue"), mm.get("operating_profit")
            seg_label = metrics.get(rev_k, seg).split("（")[0] if rev_k else seg
            parts: list[str] = []
            if rev_k and (rc := A.get((rev_k, latest))):
                seg_rev = float(rc["value_numeric"])
                p = f"売上 {_fmt(seg_rev, rc['unit'])}"
                if prev and (rp := A.get((rev_k, prev))):
                    p += f"（前年比 {_yoy_pct(seg_rev, float(rp['value_numeric']))}）"
                if total_rev_v:
                    p += f"・全社構成比 {seg_rev / total_rev_v * 100:.1f}%"
                parts.append(p)
            if op_k and (oc := A.get((op_k, latest))):
                seg_op = float(oc["value_numeric"])
                o = f"営業利益 {_fmt(seg_op, oc['unit'])}"
                if prev and (op := A.get((op_k, prev))):
                    o += f"（前年比 {_yoy_pct(seg_op, float(op['value_numeric']))}）"
                parts.append(o)
            if parts:
                lines.append(f"- {seg_label}: {' / '.join(parts)}")

    # --- 会社予想 ---
    if pf:
        lines.append(f"\n## 会社予想（連結・要明示） 期間: {', '.join(pf)}")
        for k in headline:
            cells = [
                f"{p}={_fmt(float(r['value_numeric']), r['unit'])}"
                for p in pf
                if (r := F.get((k, p)))
            ]
            if cells:
                lines.append(f"- {metrics[k]} ({k}): {' '.join(cells)} 【会社予想】")

    lines.append("\n## relevant_metrics に使える指標キー\n" + ", ".join(all_keys) + ", operating_margin")
    return ("\n".join(lines), pa, pf)


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
        # 生成IRの本文は段落改行（生の制御文字）を含むため strict=False で許容する。
        data = json.loads(resp.text, strict=False)
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
