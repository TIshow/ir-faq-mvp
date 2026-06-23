"""次の質問サジェスト（A-lite: 決定論・データ連動）。

直前の話題ではなく「その企業が実際に答えられるデータ」(store.summary)から、
開示志向のフォロー質問をテンプレで 2〜3 個組み立てる。LLM を使わない＝高速・無コスト・
コンプラ安全（助言/予測/未開示を構造的に含まない）。LLM生成版(A)は GitHub Issue #42。
"""

from __future__ import annotations

from . import store


def build_suggestions(ticker: str, max_n: int = 3, exclude: str | None = None) -> list[str]:
    """その企業の利用可能データに基づく、開示志向の次質問候補（最大 max_n 個）を返す。

    軸を散らす: 横(セグメント) / 時間(前年比・会社予想) / 株主還元(配当) / 深掘り(個別事業)。
    全てが開示事実を問う質問で、助言・予測・未開示は含めない。
    """
    try:
        summary = store.summary(ticker) if hasattr(store, "summary") else {}
    except Exception:
        summary = {}

    metrics: dict[str, str] = summary.get("metrics", {})
    periods_actual: list[str] = summary.get("periods_actual", [])
    periods_forecast: list[str] = summary.get("periods_forecast", [])

    candidates: list[str] = []
    if any(k.startswith("segment.") for k in metrics):  # 横
        candidates.append("セグメント別の業績を教えてください")
    if len(periods_actual) >= 2:  # 時間（前年比）
        candidates.append("前年と比べて業績はどうですか？")
    if periods_forecast:  # 未来（会社予想）
        candidates.append("来期の会社予想を教えてください")
    if "dividend_per_share" in metrics:  # 株主還元
        candidates.append("配当はどうなっていますか？")
    # 深掘り（具体セグメントの定性）。metric 値「中食事業（売上高）」→「中食事業」
    seg_labels = [
        v.split("（")[0]
        for k, v in metrics.items()
        if k.startswith("segment.") and k.endswith(".revenue")
    ]
    if seg_labels:
        candidates.append(f"{seg_labels[0]}について教えてください")

    # データが薄い企業向けの安全フォールバック
    if not candidates:
        candidates = ["最新の決算ハイライトを教えてください", "事業内容を教えてください"]

    out: list[str] = []
    for c in candidates:
        if exclude and c.strip() == exclude.strip():
            continue
        if c not in out:
            out.append(c)
        if len(out) >= max_n:
            break
    return out
