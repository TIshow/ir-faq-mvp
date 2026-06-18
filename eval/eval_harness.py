#!/usr/bin/env python3
"""
IR Agent 評価ハーネス（骨格）

原則:
  - 数値はコードで決定論的に厳密比較する（LLM審査を使わない）。
  - 定性の忠実性のみ LLM-as-judge / Vertex AI Gen AI Evaluation に委ねる（フック）。
  - 評価対象は AgentResponse 契約: {answer_prose, fact_cards[], citations[], scope_status, scope_reason}。

CI関門（ゼロ許容）:
  - 数値一致率 == 100%（全問、全数値が一致）
  - コンプラ誤回答 == 0件（advice / undisclosed を answered で返したらアウト）
  上記を満たさなければ exit 1。

使い方:
  - 本番: call_agent() を実エージェント呼び出しに実装し、`python eval_harness.py` を実行。
  - 検証: `python eval_harness.py --self-test` でハーネス自体のロジックを合成データで確認（エージェント不要）。
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

GOLDEN_DEFAULT = Path(__file__).with_name("golden_set.vis.jsonl")

# コンプラ上、answered で返してはいけないカテゴリ（ゼロ許容）
COMPLIANCE_CRITICAL = {"advice", "undisclosed"}

# 投資家体験 品質eval のしきい値（docs/investor-experience-quality.md §3）
# LLM-as-judge の 1〜5 採点に対する合格ライン。
QUALITY_THRESHOLDS = {
    "depth": 4.0,                # Q1 合成の深さ
    "educational": 4.0,          # Q2 教育的足場（用語質問のみ）
    "tone": 4.0,                 # 中立・専門・丁寧
    "followup_usefulness": 3.5,  # Q3 接地したフォローアップ
}
# 体感速度（Q4）
LATENCY_BUDGET = {"first_token_s": 2.0, "complete_s": 8.0}


# --------------------------------------------------------------------------- #
# データ構造
# --------------------------------------------------------------------------- #
@dataclass
class GoldCase:
    id: str
    query: str
    category: str
    expected_scope: str
    gold_numbers: list[dict[str, Any]]
    gold_citations: list[dict[str, Any]]
    gold_scope_reason: str | None


@dataclass
class CaseResult:
    id: str
    category: str
    expected_scope: str
    actual_scope: str
    numbers_ok: bool
    scope_ok: bool
    citations_ok: bool
    compliance_violation: bool
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# エージェント呼び出し（実装ポイント）
# --------------------------------------------------------------------------- #
def call_agent(query: str, company_id: str = "vis") -> dict[str, Any]:
    """
    実エージェント（ADK）を呼び出し AgentResponse(dict) を返す。
    import は遅延（--self-test を google-adk 無しで動かすため）。
    GCP/モデル/DB の認証が整っていることが前提。
    """
    import asyncio

    from agent.agent import run_agent  # 遅延 import

    # ゴールデンセットはヴィス。company コンテキストを明示（ハードコードはここ＝テスト範囲のみ）
    company = {"ticker": "5071", "name": "株式会社ヴィス",
               "datastore_id": "vis-ir-data_1752223995110"}
    return asyncio.run(run_agent(query, company))


# --------------------------------------------------------------------------- #
# 決定論的な数値マッチャ
# --------------------------------------------------------------------------- #
def numbers_match(gold_numbers: list[dict[str, Any]], fact_cards: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    """
    gold_numbers の全件が fact_cards のいずれかに (metric_key, period) で一致し、
    値が tolerance 以内で合致するか。1件でも外れたら不合格（全問正解主義）。
    """
    notes: list[str] = []
    for gold in gold_numbers:
        mk = gold["metric_key"]
        period = gold["period"]
        tol = float(gold.get("tolerance", 0))
        match = next(
            (c for c in fact_cards if c.get("metricKey") == mk and c.get("period") == period),
            None,
        )
        if match is None:
            notes.append(f"数値カード欠落: {mk}@{period}")
            return False, notes
        try:
            actual = float(match.get("valueNumeric"))
        except (TypeError, ValueError):
            notes.append(f"数値が解釈不能: {mk}@{period} -> {match.get('valueNumeric')!r}")
            return False, notes
        if abs(actual - float(gold["value"])) > tol:
            notes.append(f"数値不一致: {mk}@{period} gold={gold['value']} actual={actual} (tol={tol})")
            return False, notes
        # basis（実績/予想）の整合（gold に指定があれば）
        if "basis" in gold and match.get("basis") != gold["basis"]:
            notes.append(f"basis不一致: {mk}@{period} gold={gold['basis']} actual={match.get('basis')}")
            return False, notes
    return True, notes


def citations_present(gold_citations: list[dict[str, Any]], response: dict[str, Any]) -> bool:
    """gold_citations の各 doc が、回答の citations か fact_cards の出典に現れるか。"""
    if not gold_citations:
        return True
    present_docs = {c.get("doc") for c in response.get("citations", [])}
    for fc in response.get("fact_cards", []):
        src = fc.get("source") or {}
        if src.get("doc"):
            present_docs.add(src["doc"])
    return all(g.get("doc") in present_docs for g in gold_citations)


# --------------------------------------------------------------------------- #
# 投資家体験 品質eval（docs/investor-experience-quality.md）
# --------------------------------------------------------------------------- #
def judge_quality(query: str, category: str, response: dict[str, Any],
                  reference_citations: list[dict[str, Any]]) -> dict[str, float]:
    """
    LLM-as-judge で答えの質を 1〜5 採点する（depth/educational/tone/followup_usefulness）。
    Task #6 で Vertex AI Gen AI Evaluation / judgeモデル呼び出しを実装する。
    数値の正しさは judge に委ねない（numbers_match が担保）。
    """
    raise NotImplementedError(
        "judge_quality() は未実装です。judgeモデル（Gemini）に採点軸の定義と参照を渡して実装してください。"
        " しきい値ロジックの確認は `--self-test` を使用。"
    )


def quality_thresholds_pass(scores: dict[str, float], is_term_question: bool) -> tuple[bool, list[str]]:
    """品質スコアが QUALITY_THRESHOLDS を満たすか。educational は用語質問のみ評価。"""
    notes: list[str] = []
    ok = True
    for dim, threshold in QUALITY_THRESHOLDS.items():
        if dim == "educational" and not is_term_question:
            continue
        val = scores.get(dim)
        if val is None:
            notes.append(f"品質スコア欠落: {dim}")
            ok = False
            continue
        if val < threshold:
            notes.append(f"品質未達: {dim}={val:.1f} < {threshold}")
            ok = False
    return ok, notes


def dead_end_ok(response: dict[str, Any]) -> bool:
    """
    Q5: refused/escalated が"前進"しているか（dead-end禁止）。
    escalated は IR橋渡し（scope_reason）あり、refused は代替の語り/事実があること。
    """
    status = response.get("scope_status")
    if status == "escalated":
        return bool(response.get("scope_reason"))
    if status == "refused":
        # 代替の開示事実(fact_cards) か 誘導する語り(answer_prose) のいずれかがある
        return bool(response.get("answer_prose")) or bool(response.get("fact_cards"))
    return True


def latency_ok(metrics: dict[str, float]) -> bool:
    """Q4: 体感速度。first_token_s / complete_s が予算内か。"""
    ft = metrics.get("first_token_s")
    cp = metrics.get("complete_s")
    if ft is not None and ft >= LATENCY_BUDGET["first_token_s"]:
        return False
    if cp is not None and cp >= LATENCY_BUDGET["complete_s"]:
        return False
    return True


# --------------------------------------------------------------------------- #
# 1ケース評価
# --------------------------------------------------------------------------- #
def evaluate_case(case: GoldCase, response: dict[str, Any]) -> CaseResult:
    actual_scope = response.get("scope_status", "")
    scope_ok = actual_scope == case.expected_scope

    if case.expected_scope == "answered":
        numbers_ok, notes = numbers_match(case.gold_numbers, response.get("fact_cards", []))
        citations_ok = citations_present(case.gold_citations, response)
    else:
        # 拒否/エスカレーションでは数値・引用は問わない
        numbers_ok, notes, citations_ok = True, [], True

    # コンプラ違反: 助言/未開示を answered で返した
    compliance_violation = case.category in COMPLIANCE_CRITICAL and actual_scope == "answered"
    if compliance_violation:
        notes.append(f"⛔ コンプラ違反: {case.category} を answered で返答")

    return CaseResult(
        id=case.id,
        category=case.category,
        expected_scope=case.expected_scope,
        actual_scope=actual_scope,
        numbers_ok=numbers_ok,
        scope_ok=scope_ok,
        citations_ok=citations_ok,
        compliance_violation=compliance_violation,
        notes=notes,
    )


# --------------------------------------------------------------------------- #
# 集計・関門
# --------------------------------------------------------------------------- #
def summarize(results: list[CaseResult]) -> dict[str, Any]:
    answered = [r for r in results if r.expected_scope == "answered"]
    numeric_pass = [r for r in answered if r.numbers_ok]
    numeric_rate = (len(numeric_pass) / len(answered)) if answered else 1.0
    compliance_violations = [r for r in results if r.compliance_violation]
    scope_correct = [r for r in results if r.scope_ok]

    gate_pass = (numeric_rate >= 1.0) and (len(compliance_violations) == 0)

    return {
        "total": len(results),
        "numeric_rate": numeric_rate,
        "numeric_pass": len(numeric_pass),
        "answered_total": len(answered),
        "compliance_violations": len(compliance_violations),
        "scope_accuracy": (len(scope_correct) / len(results)) if results else 1.0,
        "gate_pass": gate_pass,
    }


def print_report(results: list[CaseResult], summary: dict[str, Any]) -> None:
    print("\n=== IR Agent 評価レポート ===")
    for r in results:
        flag = "✅" if (r.scope_ok and r.numbers_ok and r.citations_ok and not r.compliance_violation) else "❌"
        print(f"{flag} [{r.id}] {r.category} scope={r.actual_scope}(期待={r.expected_scope}) "
              f"num={'OK' if r.numbers_ok else 'NG'} cite={'OK' if r.citations_ok else 'NG'}")
        for n in r.notes:
            print(f"      - {n}")
    print("\n--- サマリ ---")
    print(f"数値一致率: {summary['numeric_rate']*100:.1f}% ({summary['numeric_pass']}/{summary['answered_total']})")
    print(f"スコープ正解率: {summary['scope_accuracy']*100:.1f}%")
    print(f"コンプラ違反: {summary['compliance_violations']} 件")
    print(f"CI関門(ゼロ許容): {'PASS ✅' if summary['gate_pass'] else 'FAIL ❌'}")


# --------------------------------------------------------------------------- #
# ローダ／実行
# --------------------------------------------------------------------------- #
def load_golden(path: Path) -> list[GoldCase]:
    cases: list[GoldCase] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        d = json.loads(line)
        cases.append(
            GoldCase(
                id=d["id"],
                query=d["query"],
                category=d["category"],
                expected_scope=d["expected_scope"],
                gold_numbers=d.get("gold_numbers", []),
                gold_citations=d.get("gold_citations", []),
                gold_scope_reason=d.get("gold_scope_reason"),
            )
        )
    return cases


def run(golden_path: Path, agent: Callable[[str, str], dict[str, Any]]) -> int:
    cases = load_golden(golden_path)
    results = [evaluate_case(c, agent(c.query, "vis")) for c in cases]
    summary = summarize(results)
    print_report(results, summary)
    return 0 if summary["gate_pass"] else 1


# --------------------------------------------------------------------------- #
# セルフテスト（エージェント不要でハーネスのロジックを検証）
# --------------------------------------------------------------------------- #
def _self_test() -> int:
    """合成の AgentResponse でマッチャ・関門ロジックの正しさを確認。"""
    ok = True

    # 数値一致（合格）
    resp_ok = {
        "answer_prose": "増益となりました。",
        "fact_cards": [{"metricKey": "operating_profit", "period": "2025FY",
                        "valueNumeric": 314, "basis": "actual",
                        "source": {"doc": "2025年4Q決算短信", "page": 3}}],
        "citations": [{"doc": "2025年4Q決算短信", "page": 3}],
        "scope_status": "answered",
    }
    m, _ = numbers_match([{"metric_key": "operating_profit", "period": "2025FY", "value": 314, "tolerance": 0}],
                         resp_ok["fact_cards"])
    ok &= (m is True)

    # 数値不一致（不合格）
    m2, _ = numbers_match([{"metric_key": "operating_profit", "period": "2025FY", "value": 315, "tolerance": 0}],
                          resp_ok["fact_cards"])
    ok &= (m2 is False)

    # カード欠落（不合格）
    m3, _ = numbers_match([{"metric_key": "revenue", "period": "2025FY", "value": 5200, "tolerance": 0}],
                          resp_ok["fact_cards"])
    ok &= (m3 is False)

    # コンプラ違反検出: advice を answered で返す
    case_adv = GoldCase("t-adv", "買うべき?", "advice", "refused", [], [], "advice")
    r_adv = evaluate_case(case_adv, {"scope_status": "answered", "fact_cards": [], "citations": []})
    ok &= (r_adv.compliance_violation is True)

    # 正しく拒否（違反なし）
    r_adv_ok = evaluate_case(case_adv, {"scope_status": "refused", "fact_cards": [], "citations": []})
    ok &= (r_adv_ok.compliance_violation is False and r_adv_ok.scope_ok is True)

    # 関門: 違反1件で FAIL
    summary = summarize([r_adv])
    ok &= (summary["gate_pass"] is False)

    # 関門: 全合格で PASS
    case_fact = GoldCase("t-fact", "営業利益?", "fact", "answered",
                         [{"metric_key": "operating_profit", "period": "2025FY", "value": 314, "tolerance": 0}],
                         [{"doc": "2025年4Q決算短信", "page": 3}], None)
    summary2 = summarize([evaluate_case(case_fact, resp_ok), r_adv_ok])
    ok &= (summary2["gate_pass"] is True and summary2["numeric_rate"] == 1.0)

    # 品質しきい値: 合格／未達
    qp, _ = quality_thresholds_pass(
        {"depth": 4.2, "tone": 4.5, "followup_usefulness": 3.6}, is_term_question=False)
    ok &= (qp is True)
    qf, _ = quality_thresholds_pass(
        {"depth": 3.5, "tone": 4.5, "followup_usefulness": 3.6}, is_term_question=False)
    ok &= (qf is False)
    # educational は用語質問のみ評価
    qskip, _ = quality_thresholds_pass(
        {"depth": 4.2, "tone": 4.5, "followup_usefulness": 3.6}, is_term_question=False)
    ok &= (qskip is True)  # educational欠落でも非用語なら影響なし
    qterm, _ = quality_thresholds_pass(
        {"depth": 4.2, "tone": 4.5, "followup_usefulness": 3.6, "educational": 3.0}, is_term_question=True)
    ok &= (qterm is False)  # 用語質問で educational 未達

    # dead-end チェック
    ok &= (dead_end_ok({"scope_status": "escalated", "scope_reason": "out_of_corpus"}) is True)
    ok &= (dead_end_ok({"scope_status": "escalated"}) is False)
    ok &= (dead_end_ok({"scope_status": "refused", "answer_prose": "開示済みの範囲ではこちらです…"}) is True)
    ok &= (dead_end_ok({"scope_status": "refused", "answer_prose": "", "fact_cards": []}) is False)

    # レイテンシ予算
    ok &= (latency_ok({"first_token_s": 1.2, "complete_s": 5.0}) is True)
    ok &= (latency_ok({"first_token_s": 2.5, "complete_s": 5.0}) is False)

    print("セルフテスト:", "PASS ✅" if ok else "FAIL ❌")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="IR Agent 評価ハーネス")
    ap.add_argument("--golden", type=Path, default=GOLDEN_DEFAULT, help="ゴールデンセット(.jsonl)")
    ap.add_argument("--self-test", action="store_true", help="エージェント不要でハーネスのロジックを検証")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()
    return run(args.golden, call_agent)


if __name__ == "__main__":
    sys.exit(main())
