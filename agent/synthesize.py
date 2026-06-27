"""Grounded Synthesis / 生成IR パイプライン（金融コパイロット型）。

従来の「LLMがツールを選ぶ agentic ループ」を、決定論 retrieve → 統合分析 → 接地 に置換する。狙い:
  - 横断質問の統合分析（数値＋定性＋FAQを1回答に＝生成IR）
  - ツール選択の脆さを排除（retrieve は常に全部・決定論）
  - answerability 判定（制約「数値で」「10年分」を満たせなければ正直にエスカレーション）
  - 数値の正確性は維持（LLMは『どの指標を見せるか』だけ選ぶ。値はコードが facts から埋める）

回答は2フェーズで生成し、本文をトークン逐次ストリーミングする（synthesize_stream）:
  1. PLAN  : answerability 判定＋カード指標/引用の選択（JSONモード＝eval関門の決定論性を守る）
  2. WRITE : 生成IRの本文をプレーンテキストで generate_content_stream（トークン逐次）
LLMには「実数＋前年比・利益率・構成比（コード計算済み）」のデータシートを渡し暗算させない。

config.ANSWER_MODE == 'synthesis' のときに agent.run_agent_stream から呼ばれる。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from google.genai import types

from . import config, store
from .tools import CompanyCtx, build_financial_facts, search_disclosures

_log = logging.getLogger("ir-agent.synth")
_client = None

# 接地できないときの正直なフォールバック文（エスカレ理由が空の場合に使う）
_NO_ANSWER = "開示資料では確認できませんでした。"


def _genai_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(
            vertexai=True, project=config.PROJECT_ID, location=config.VERTEX_LOCATION
        )
    return _client


# 生成IRは2フェーズ: PLAN（判定・指標選択＝JSON。eval関門の決定論性を守るため構造化出力）→
# WRITE（本文をプレーンテキストでストリーミング）。判定は温存し本文だけ逐次表示する。

PLAN_PROMPT = """あなたは {company_name} の開示情報を案内するIRアナリストの「判断」担当です。
質問に**開示済みの事実の範囲で答えられるか**を判定し、答えるなら表示する財務指標カードと出典を選びます（本文は書きません）。

# 判定の鉄則
- 開示済みの事実のみ。下記「財務数値」と「開示資料の抜粋」に無いことは答えない。
- 投資助言・推奨・将来予測・未開示情報は答えない（開示済みの「会社予想」は可）。

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
- relevant_metrics は回答の**中心指標に絞る**（業績全般など広い質問でも網羅しない。詳細は本文の表が担う）。

# 質問
{query}

# 財務数値（{company_name}・連結・検証済み実数。前年比・利益率・構成比は計算済み）
{facts_context}

# 開示資料の抜粋（FAQ含む・番号付き。used_citations にこの番号(整数)を使う）
{passages_context}

# 出力（JSONのみ・前後に文を付けない）
{{
  "can_answer": true/false,
  "relevant_metrics": ["カード表示する metric_key。定性のみ・該当無しなら空配列"],
  "used_citations": [使った抜粋の番号(整数)],
  "escalate_reason": "can_answer=false の時の正直な理由（true の時は空文字）"
}}

注: 抜粋の番号 [0][1]… は内部参照用。escalate_reason には書かない（資料に触れるなら資料名で）。
"""


WRITE_PROMPT = """あなたは {company_name} の開示情報をもとに、個人投資家へ深い洞察を届ける**IRアナリスト**です。
この質問は開示済みの事実で**答えられる**と判定済みです。下記データだけを根拠に、**生成IRの本文**を書いてください。
価値は数値の列挙やFAQの引き写しではなく、'なぜか・何を意味するか・どこが注目点か'まで踏み込んだ分析です。

# 鉄則（必ず守る）
- 開示済みの事実のみ。下記「財務数値」と「開示資料の抜粋」に無い数字・事実は作らない・推測しない。
- 投資助言・推奨（買う/売る/割安等）や将来予測はしない。開示済みの「会社予想」は『会社予想』と明示すれば述べてよい。
- 未開示の重要情報は述べない。
- **数値は下の「財務数値」（実数・前年比・利益率・構成比は計算済み）と開示抜粋に書かれた範囲だけで使う。**
  自分で新たな割り算・掛け算をして数字を作らない。表に無い比率は「開示資料に記載はありません」と述べる。
- FAQや抜粋を**そのまま引き写さない**。複数の情報源を統合し、自分の言葉で分析・説明する。

# 書き方（生成IR）
- 質問に直接答えたうえで、背景・ドライバー（牽引したセグメント等）・前年比較・含意まで踏み込む。
- 傾向だけでなく**具体的な数値・変化率を交えて**説得力を持たせてよい（数値はカードと出典が裏取りする）。
- 質問に応じ Markdown の**表や箇条書き**で構造化してよい。表の数字も上の「財務数値」の範囲のみ。
- 長さは質問に応じて調整（定型の事実確認は簡潔に、分析・比較質問は厚く）。免責の繰り返しや冗長な前置きはしない。
- 特に次の指標に言及するとよい（カードと対応）: {focus_metrics}

# 質問
{query}

# 財務数値（{company_name}・連結・検証済み実数。前年比・利益率・構成比は計算済み＝分析に自由に使ってよい）
{facts_context}

# 開示資料の抜粋（FAQ含む・番号付き）
{passages_context}

# 出力
本文のみをプレーンテキスト（Markdown可）で書く。JSON や「本文:」等の前置き・見出しは付けない。
抜粋の番号 [0][1]… は内部参照用。本文には書かない（資料に触れるなら資料名で述べる）。
"""


# 短期メモリ: フォロー質問（「なんで？」「それは？」「前期は？」等）を、会話履歴を使って
# **自己完結した質問に書き換える**（condense question）。検索・判定が文脈なしで成立するようにする。
CONTEXTUALIZE_PROMPT = """次は {company_name} のIRに関する会話です。会話履歴を踏まえ、最新の質問を
**それ単体で意味が通る独立した質問**に書き換えてください（指示語・省略を、履歴中の主語/指標/期間/事業で補う）。

- 既に独立して意味が通るならそのまま返す。
- 話題を変えず、履歴に無い情報は足さない。質問の言語（日本語）を保つ。
- 書き換えた質問の**一文のみ**を出力（前置き・説明・引用符は付けない）。

# 会話履歴
{history}

# 最新の質問
{query}

# 書き換えた独立質問（一文のみ）:"""


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


def _strip_refs(text: str) -> str:
    """内部用の抜粋インデックス（[0] や 開示資料[0]）がユーザー向け本文に漏れたら除去する。
    番号は used_citations 選択のための機械間符号でありユーザーには無意味なため。"""
    if not text:
        return text
    return re.sub(r"\s*\[\d+\]", "", text)


def _reduce_cards(cards: list[dict[str, Any]], max_n: int) -> list[dict[str, Any]]:
    """カード過多の抑制。max_n 以下ならそのまま（狭い質問は無傷＝eval関門に影響なし）。
    超過時のみ: ①各指標を最新実績1枚（YoYバッジ付き。無ければ最新予想）に畳む
    ②ヘッドライン優先（segment.* を後ろ）で安定ソート ③max_n で truncate。
    詳細はprose内の表が担うため、間引いた枚数はログに出す（サイレント切り捨てを避ける）。"""
    if len(cards) <= max_n:
        return cards

    # ① 指標ごとに最新実績（actual優先・期間が新しい方）を1枚選ぶ
    def score(c: dict[str, Any]) -> tuple[int, int]:
        return (1 if c.get("basis") == "actual" else 0, _year_key(str(c.get("period", ""))))

    best: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for c in cards:
        k = str(c.get("metricKey"))
        if k not in best:
            order.append(k)
            best[k] = c
        elif score(c) > score(best[k]):
            best[k] = c
    collapsed = [best[k] for k in order]

    # ② ヘッドライン優先（segment.* を後ろ）。安定ソートで元の相対順を保つ
    collapsed.sort(key=lambda c: 1 if str(c.get("metricKey", "")).startswith("segment.") else 0)

    shown = collapsed[:max_n]
    _log.info("カード抑制: %d枚 → %d枚表示（残りはprose内の表で提示）", len(cards), len(shown))
    return shown


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
                yoy = (
                    f"（前年比 {_yoy_pct(float(rc['value_numeric']), float(rp['value_numeric']))}）"
                )
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

    # 派生指標（カード化可能・コード計算）も選択肢として明示する。
    derived_adv: list[str] = []
    if "operating_profit" in all_keys and "revenue" in all_keys:
        derived_adv.append("operating_margin")
    if "gross_profit" in all_keys and "revenue" in all_keys:
        derived_adv.append("gross_margin")
    if "net_income" in all_keys and "revenue" in all_keys:
        derived_adv.append("net_margin")
    for seg, mm in segs.items():
        if "revenue" in mm:
            derived_adv.append(f"segment.{seg}.revenue_contribution")  # 売上構成比
        if "revenue" in mm and "operating_profit" in mm:
            derived_adv.append(f"segment.{seg}.operating_margin")  # セグメント営業利益率
            derived_adv.append(f"segment.{seg}.profit_contribution")  # 営業利益寄与度

    lines.append(
        "\n## relevant_metrics に使える指標キー（派生指標も選択可＝利益率・構成比・寄与度をカード化）\n"
        + ", ".join(all_keys + derived_adv)
    )
    return ("\n".join(lines), pa, pf)


def _retrieve(query: str, company: dict[str, Any], ticker: str):
    """決定論 retrieve: 層1データシート＋層2検索パッセージ。(facts_ctx, pa, pf, passages, passages_ctx)。"""
    facts_ctx, pa, pf = _facts_context(ticker)
    try:
        passages = search_disclosures(query, CompanyCtx(company)).get("passages", [])
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
    return facts_ctx, pa, pf, passages, passages_ctx


def _contextualize(name: str, history: list[dict[str, str]], query: str) -> str:
    """短期メモリ: 会話履歴でフォロー質問を自己完結クエリに書き換える（condense question）。
    履歴が無ければ LLM を呼ばずそのまま返す（eval は履歴なし＝従来と完全に同一挙動）。"""
    if not history:
        return query
    lines = []
    for t in history[-6:]:
        role = "投資家" if t.get("role") == "user" else "アシスタント"
        lines.append(f"{role}: {str(t.get('content', ''))[:600]}")
    prompt = CONTEXTUALIZE_PROMPT.format(
        company_name=name, history="\n".join(lines) or "（なし）", query=query
    )
    try:
        resp = _genai_client().models.generate_content(
            model=config.MODEL_NAME,
            contents=[prompt],
            config=types.GenerateContentConfig(temperature=0),
        )
        rewritten = (resp.text or "").strip().splitlines()[0].strip() if resp.text else ""
        # 失敗・空・極端に長い場合は元の質問にフォールバック（安全側）。
        if rewritten and len(rewritten) <= 300:
            if rewritten != query:
                _log.info("contextualize: %r → %r", query, rewritten)
            return rewritten
    except Exception as e:
        _log.warning("contextualize 失敗（元の質問で続行）: %s", e)
    return query


def _plan(name: str, query: str, facts_ctx: str, passages_ctx: str) -> dict[str, Any]:
    """PLAN: answerability 判定＋カード指標・引用の選択（構造化JSON・eval関門の決定論性を守る）。"""
    prompt = PLAN_PROMPT.format(
        company_name=name, query=query, facts_context=facts_ctx, passages_context=passages_ctx
    )
    resp = _genai_client().models.generate_content(
        model=config.MODEL_NAME,
        contents=[prompt],
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0),
    )
    return json.loads(resp.text, strict=False)


def _ground(ticker, pa, pf, rel_metrics, used, passages):
    """GROUND（決定論）: 指標→カード（値はコードが埋める・過多は抑制）、番号→引用。"""
    fact_cards: list[dict[str, Any]] = []
    if rel_metrics:
        company_id = store.resolve_company_id(ticker)
        if company_id is not None:
            if pa:
                fact_cards += build_financial_facts(company_id, rel_metrics, pa, True, "actual")
            if pf:
                fact_cards += build_financial_facts(company_id, rel_metrics, pf, True, "forecast")
    fact_cards = _reduce_cards(fact_cards, config.MAX_FACT_CARDS)
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
    return fact_cards, citations


def _write_stream(name, query, facts_ctx, passages_ctx, focus_metrics):
    """WRITE: 生成IRの本文をプレーンテキストでストリーミング生成。チャンクの text を yield。"""
    prompt = WRITE_PROMPT.format(
        company_name=name,
        query=query,
        facts_context=facts_ctx,
        passages_context=passages_ctx,
        focus_metrics=", ".join(focus_metrics) or "（主要指標）",
    )
    stream = _genai_client().models.generate_content_stream(
        model=config.MODEL_NAME,
        contents=[prompt],
        config=types.GenerateContentConfig(temperature=0),
    )
    for chunk in stream:
        t = getattr(chunk, "text", None)
        if t:
            yield t


def _escalate_stream(reason: str):
    """エスカレ応答を stream プロトコルで返す（短文を1回 prose_delta → final）。"""
    resp = _escalate(reason)
    yield {"type": "prose_delta", "text": resp["answer_prose"]}
    yield {"type": "final", "response": resp}


def synthesize_stream(
    query: str, company: dict[str, Any], history: list[dict[str, str]] | None = None
):
    """生成IR をストリーミング。yield {"type":"prose_delta",...} 群 → {"type":"final",...}。
    CONTEXTUALIZE（フォロー質問の書き換え）→ RETRIEVE → PLAN（判定・接地）→ WRITE（本文をトークン逐次）。
    history が無ければ書き換えをスキップ＝従来と同一挙動。suggestions は agent 側で付与。"""
    ticker = str(company.get("ticker") or "")
    name = company.get("name") or "対象企業"

    # 短期メモリ: 履歴があればフォロー質問を自己完結クエリに書き換えてから retrieve/plan に渡す。
    query = _contextualize(name, history or [], query)

    facts_ctx, pa, pf, passages, passages_ctx = _retrieve(query, company, ticker)

    # PLAN（判定）
    try:
        data = _plan(name, query, facts_ctx, passages_ctx)
    except Exception as e:
        _log.warning("synthesize plan 失敗: %s", e)
        yield from _escalate_stream("ただいま回答を生成できませんでした。")
        return

    can_answer = bool(data.get("can_answer"))
    rel_metrics = [m for m in (data.get("relevant_metrics") or []) if isinstance(m, str)]
    used = [i for i in (data.get("used_citations") or []) if isinstance(i, int)]
    escalate_reason = str(data.get("escalate_reason") or "").strip()

    if not can_answer:
        yield from _escalate_stream(escalate_reason or _NO_ANSWER)
        return

    # GROUND（決定論）。接地ゼロ＝実質未回答 → エスカレ
    fact_cards, citations = _ground(ticker, pa, pf, rel_metrics, used, passages)
    if not fact_cards and not citations:
        yield from _escalate_stream(escalate_reason or _NO_ANSWER)
        return

    # WRITE（本文をストリーミング）
    parts: list[str] = []
    try:
        for t in _write_stream(name, query, facts_ctx, passages_ctx, rel_metrics):
            parts.append(t)
            yield {"type": "prose_delta", "text": t}
    except Exception as e:
        _log.warning("synthesize write(stream) 失敗: %s", e)
    prose = _strip_refs("".join(parts).strip())
    if not prose:
        prose = "開示済みの数値・資料に基づき、以下にお示しします。"
        yield {"type": "prose_delta", "text": prose}

    yield {
        "type": "final",
        "response": {
            "answer_prose": prose,
            "fact_cards": fact_cards,
            "citations": citations,
            "scope_status": "answered",
            "scope_reason": None,
        },
    }


def _escalate(reason: str) -> dict[str, Any]:
    msg = f"{_strip_refs(reason)} 恐れ入りますが、IR窓口へお問い合わせください。"
    return {
        "answer_prose": msg,
        "fact_cards": [],
        "citations": [],
        "scope_status": "escalated",
        "scope_reason": "out_of_corpus",
    }
