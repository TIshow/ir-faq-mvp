"""
入口スコープ分類（②ガードレールの第1層・多層防御）。

決定論的なルールで「明白に危険な」クエリ（助言/予測/未開示要求）を短絡的に拒否する。
ここで拾えない微妙なケースは、エージェントのシステムプロンプト(鉄則)が第2層として守る。

注: PoCはルールベース。堅牢化フェーズで軽量モデル分類器に差し替え可能（同じ戻り値契約）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# scope_reason は AgentResponse 契約と一致させる
Reason = str  # 'advice' | 'prediction' | 'undisclosed' | 'out_of_corpus' | 'unknown'


@dataclass
class ScopeDecision:
    status: str  # 'answered' | 'refused' | 'escalated'
    reason: Reason | None  # refused/escalated のとき
    message: str | None  # 短絡時にユーザーへ返す丁寧文（answered では None）


# 投資助言（買う/売る/割安・割高/今が買い時 等）
_ADVICE = re.compile(
    r"(買うべき|売るべき|買い時|売り時|買った方|売った方|割安|割高|おすすめ|"
    r"投資すべき|儲かりますか|得ですか|どう思いますか.*株)"
)
# 将来予測（株価予想・将来の数値の断定要求）。"会社予想"は除外する。
_PREDICTION = re.compile(
    r"(株価.*(上がり|下がり|どうなる|予想|見通し)|"
    r"将来.*(いくら|どうなる)|来期.*(予想|見込み).*(あなた|AIの))"
)
# 未開示の重要情報の先出し要求
_UNDISCLOSED = re.compile(
    r"(まだ.*発表|未発表|未公表|公表前|発表前|次の決算の数字を先に|インサイダー|"
    r"内部情報|これから出る.*数字)"
)
# 「会社予想」を聞くのは許可（予測ではなく開示事実）
_COMPANY_FORECAST_OK = re.compile(r"(会社予想|会社の予想|今期予想|通期予想|業績予想)")


def classify_scope(query: str) -> ScopeDecision:
    """明白な助言/予測/未開示要求を短絡的に拒否。それ以外は answered（エージェントに委ねる）。"""
    q = query.strip()

    if _UNDISCLOSED.search(q):
        return ScopeDecision(
            "refused",
            "undisclosed",
            "未開示の情報にはお答えできません。すでに開示されている内容についてはお手伝いできます。",
        )

    if _ADVICE.search(q):
        return ScopeDecision(
            "refused",
            "advice",
            "投資判断の助言はいたしかねます。開示済みの業績や事業内容についてはお答えできますので、"
            "知りたい点をお聞かせください。",
        )

    # 「会社予想」を尋ねる質問は予測ではない（開示事実）→ 通す
    if _PREDICTION.search(q) and not _COMPANY_FORECAST_OK.search(q):
        return ScopeDecision(
            "refused",
            "prediction",
            "将来の予測はいたしかねます。開示済みの『会社予想』であればご案内できます。",
        )

    return ScopeDecision("answered", None, None)
