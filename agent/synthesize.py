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
from concurrent.futures import ThreadPoolExecutor
from typing import Any, NamedTuple

from google.genai import types

from . import config, store
from .analytics import TOPICS, normalize_topic
from .tools import CompanyCtx, build_financial_facts, search_disclosures

_log = logging.getLogger("ir-agent.synth")
_client = None

# 接地できないときの正直なフォールバック文（エスカレ理由が空の場合に使う）
_NO_ANSWER = "開示資料では確認できませんでした。"

# 開示抜粋が無いときにエスカレする場合の**定型文**（#151）。
#
# `escalate_reason` はLLMの自由文なので、プロンプトで禁じても創作が漏れる。
# 実測では「要因（コスト削減、不採算店舗の閉鎖、商品構成の変化など）の記述がない」と、
# **答えられないと言いながら答えの候補を創作して例示**していた。
#
# 数値と同じ切り分けにする: **判断はLLM（can_answer）、文言はコード。**
# 何が無いかだけを述べ、答えの候補を並べない。
#
# **何を聞かれたかを推測しない**（#162）。旧文は「ご質問の背景・要因については〜」と
# 決め打ちしていたが、この文は層2の抜粋が無いとき常に使われるので、数値を聞かれた場合にも
# 「背景・要因が無い」と答えていた（実測: ゲオ 2681 に「セグメント別の業績」を聞いた例）。
# しかも「数値そのものは確認できます」と言いながら、その数値を出していなかった。
_NO_MATERIAL = "ご質問にお答えできる記述は、当方が保有する開示資料では確認できませんでした。"

# 答えられる指標を実データから並べる（#162）。**何が無いかだけ言われても次の一手が分からない。**
# 出典は層1（XBRLのタグ）なので、ラベルも実データ由来＝LLMを通さない。
_AVAILABLE_MAX = 6

# 並べる順。**辞書順に頼らない。** `metrics` のキー順で先頭6件を切ると
# bps / dividend_per_share / eps … が先に来て、**売上高と営業利益が枠から漏れる**
# （実測: ゲオ 2681）。投資家がまず聞くものから並べる。ここに無いキーは後ろへ。
_METRIC_ORDER = [
    "revenue",
    "operating_profit",
    "ordinary_profit",
    "net_income",
    "gross_profit",
    "eps",
    "dividend_per_share",
    "roe",
    "equity_ratio",
    "total_assets",
    "net_assets",
    "bps",
]


def _available_metrics_line(ticker: str) -> str:
    """「これなら答えられる」を層1から組み立てる。数値が無ければ空文字。"""
    s = store.summary(ticker) if hasattr(store, "summary") else {}
    metrics: dict[str, str] = s.get("metrics") or {}
    # セグメント別（`segment.<事業>.<指標>`）は名前が長く列挙に向かないので全社指標だけ
    keys = [k for k in metrics if "." not in k and metrics[k]]
    keys.sort(
        key=lambda k: (_METRIC_ORDER.index(k) if k in _METRIC_ORDER else len(_METRIC_ORDER), k)
    )
    if not keys:
        return ""
    shown = "・".join(metrics[k] for k in keys[:_AVAILABLE_MAX])
    more = "など" if len(keys) > _AVAILABLE_MAX else ""
    periods = s.get("periods_actual") or []
    span = f"（{periods[0]}〜{periods[-1]}）" if len(periods) >= 2 else ""
    return f"この企業については、有価証券報告書の{shown}{more}{span}をお答えできます。"


# 層1すら無い企業（レジストリにはあるが数値を取り込んでいない）。
# `_NO_MATERIAL` は「数値はあるが背景が無い」と言っており、**数値も無い企業には嘘になる**
# （実測: トヨタ 7203 に売上高を聞いて「数値そのものは開示資料から確認できます」と返した）。
_NO_FACTS = "この企業の決算数値は、まだ当方に取り込まれていません。"

# 2角度検索を合算した後にプロンプトへ入れる抜粋の上限（肥大化とレイテンシの抑制）
_MAX_PASSAGES = 12


def _genai_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(
            vertexai=True, project=config.PROJECT_ID, location=config.VERTEX_LOCATION
        )
    return _client


# --- 生成呼び出し（thinking 最小化＋多段フォールバック）-----------------------
# gemini-3 系は既定で動的 thinking が走り、先頭トークンまでのレイテンシを大きく食う。
# 本パイプラインは全フェーズの入力が「コード計算済みデータシート＋開示抜粋」で完結して
# おり深い内部推論は不要のため、thinking を最小化して速度を稼ぐ（品質は eval 関門で担保）。
# SDK・モデル世代の差異に備え thinking_level("low") → thinking_budget(0) → 指定なし の順に
# 試し、効いた設定をプロセス内で記憶する（フォールバック探索は初回のみ）。
_THINK_STYLES: list[dict[str, Any] | None] = [
    {"thinking_level": "low"},
    {"thinking_budget": 0},
    None,
]
_think_idx: int | None = None


def _mk_config(json_mode: bool, style: dict[str, Any] | None) -> types.GenerateContentConfig:
    kw: dict[str, Any] = {"temperature": 0}
    if json_mode:
        kw["response_mime_type"] = "application/json"
    if style is not None:
        kw["thinking_config"] = types.ThinkingConfig(**style)
    return types.GenerateContentConfig(**kw)


def _style_candidates() -> list[int]:
    return [_think_idx] if _think_idx is not None else list(range(len(_THINK_STYLES)))


def _remember_style(i: int) -> None:
    global _think_idx
    if _think_idx is None:
        _think_idx = i
        _log.info("thinking設定を確定: %s", _THINK_STYLES[i])


def _generate(contents: list[str], json_mode: bool = False):
    """generate_content を thinking 最小化つきで呼ぶ（未対応の設定は順にフォールバック）。"""
    last: Exception | None = None
    for i in _style_candidates():
        try:
            cfg = _mk_config(json_mode, _THINK_STYLES[i])
        except Exception:
            continue  # SDK が thinking_level 等を知らない場合は次候補へ
        try:
            r = _genai_client().models.generate_content(
                model=config.MODEL_NAME, contents=contents, config=cfg
            )
            _remember_style(i)
            return r
        except Exception as e:
            last = e
            if _THINK_STYLES[i] is not None:
                continue  # thinking 設定がモデル未対応の可能性 → 次候補で再試行
            raise
    raise last if last else RuntimeError("generate に失敗しました")


def _generate_stream(contents: list[str]):
    """generate_content_stream 版。先頭チャンク取得までで設定エラーを顕在化させてから返す。"""
    last: Exception | None = None
    for i in _style_candidates():
        try:
            cfg = _mk_config(False, _THINK_STYLES[i])
        except Exception:
            continue
        try:
            stream = _genai_client().models.generate_content_stream(
                model=config.MODEL_NAME, contents=contents, config=cfg
            )
            it = iter(stream)
            first = next(it, None)
            _remember_style(i)

            def _chain(first=first, it=it):
                if first is not None:
                    yield first
                yield from it

            return _chain()
        except Exception as e:
            last = e
            if _THINK_STYLES[i] is not None:
                continue
            raise
    raise last if last else RuntimeError("generate_stream に失敗しました")


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
  "escalate_reason": "can_answer=false の時の正直な理由（true の時は空文字）",
  "topic": "質問の話題。次から1つだけ選ぶ（新しい語を作らない）: {topics}"
}}

注: 抜粋の番号 [0][1]… は内部参照用。escalate_reason には書かない（資料に触れるなら資料名で）。
注: **escalate_reason に「答えの候補」を書かない。** 「要因（コスト削減、不採算店舗の閉鎖など）の
記述がない」のように例示すると、答えられないと言いながら**開示に無い原因を創作して提示する**
ことになる（#151）。「〜についての会社の説明は開示資料に見当たりません」と、**何が無いかだけ**を述べる。
"""


WRITE_PROMPT = """{role}
この質問は開示済みの事実で**答えられる**と判定済みです。下記データだけを根拠に、**本文**を書いてください。

# 鉄則（必ず守る）
- 開示済みの事実のみ。下記「財務数値」と「開示資料の抜粋」に無い数字・事実は作らない・推測しない。
- 投資助言・推奨（買う/売る/割安等）や将来予測はしない。開示済みの「会社予想」は『会社予想』と明示すれば述べてよい。
- 未開示の重要情報は述べない。
- **数値は下の「財務数値」（実数・前年比・利益率・構成比は計算済み）と開示抜粋に書かれた範囲だけで使う。**
  自分で新たな割り算・掛け算をして数字を作らない。表に無い比率は「開示資料に記載はありません」と述べる。
- FAQや抜粋を**そのまま引き写さない**。複数の情報源を統合し、自分の言葉で分析・説明する。

# 書き方（生成IR）
{causal_rule}
- 傾向だけでなく**具体的な数値・変化率を交えて**説得力を持たせてよい（数値はカードと出典が裏取りする）。
- 質問に応じ Markdown の**表や箇条書き**で構造化してよい。表の数字も上の「財務数値」の範囲のみ。
{insight_rule}
- 長さは質問に応じて調整（定型の事実確認は簡潔に、分析・比較質問は厚く）。免責の繰り返しや冗長な前置きはしない。
- 特に次の指標に言及するとよい（カードと対応）: {focus_metrics}

# 読者レベル（説明の"翻訳度"だけを調整する。内容の専門性・正確性は絶対に落とさない）
{audience_style}

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


# WRITE に渡す指示は**手元の材料で決まる**（#151）。
#
# 開示抜粋が空のとき、材料は数値の表だけになる。それでも従来は
# 「深い洞察を届けるIRアナリスト」「'なぜか'まで踏み込んだ分析」と要求していたため、
# LLMは書ける唯一の方法——**事前学習知識による穴埋め**——で埋めた。
#
# 実測（ハークスレイ・抜粋なし・「なぜ営業利益が伸びたのですか？」）:
#   「不採算店舗の整理やオペレーションの効率化…が利益を押し上げたことを示唆しています」
#   「原材料価格や物流コストの影響を受けやすい事業特性もあり」
# これらの語は**入力に1語も存在しない**。出典0件のまま因果として書かれていた。
#
# 禁止事項（「推測しない」）は元から書いてあった。**禁止と要求が矛盾すると要求が勝つ。**
# だから禁止を強めるのではなく、**材料が無いときは要求しない**。
class WriteStyle(NamedTuple):
    """材料の有無で切り替わる WRITE の指示。**3つまとめて**切り替える。

    ばらばらに選ぶと「役割は抑えたが注目ポイントは踏み込ませたまま」のような
    中途半端な組み合わせが生まれる。項目を足すときも両方に足す必要が出る形にしておく。
    """

    role: str  # 冒頭の役割定義（{company_name} を含む）
    causal_rule: str  # 「なぜ」をどう扱うか
    insight_rule: str  # 💡注目ポイントの範囲


_STYLE_WITH_PASSAGES = WriteStyle(
    role=(
        "あなたは {company_name} の開示情報をもとに、個人投資家へ深い洞察を届ける**IRアナリスト**です。\n"
        "価値は数値の列挙やFAQの引き写しではなく、'なぜか・何を意味するか・どこが注目点か'まで"
        "踏み込んだ分析です。"
    ),
    causal_rule=(
        "- 質問に直接答えたうえで、背景・ドライバー（牽引したセグメント等）・前年比較・含意まで踏み込む。\n"
        "- **開示抜粋の中に、質問対象の根拠・背景・会社自身の説明（過去の説明資料・IR想定問答）があれば、\n"
        "  数値とセットで本文へ織り込む**（例:「会社は◯◯が要因と説明しています」）。数値の列挙で終わらせない。"
    ),
    insight_rule=(
        "- 本文の最後に「#### 💡 注目ポイント」の見出しで、開示事実の範囲で投資家が見落としやすい観点\n"
        "  （数値どうしの対比・構造変化・会社説明と数値の対応関係）を1〜3点の箇条書きで添える。\n"
        "  **意見・評価・推奨・将来予測は書かない**（事実の対比と開示済み説明の指摘に徹する）。"
        "材料が無ければこの節は省略。"
    ),
)

# 抜粋が無いときは、書けることが**数値の対比だけ**になる。
# 「見落としやすい観点」のような広い要求は推測の逃げ道になるので、範囲を明示して狭める。
_STYLE_FACTS_ONLY = WriteStyle(
    role=(
        "あなたは {company_name} の**開示済みの財務数値だけ**を案内する担当です。\n"
        "手元にあるのは下記の数値の表だけで、会社の説明資料はありません。"
        "**数値から読み取れることだけを、正確に、分かりやすく伝えてください。**"
    ),
    causal_rule=(
        "- 質問に直接答えたうえで、**数値どうしの対比**（期間比較・セグメント間の差・構成比の変化）を示す。\n"
        "- **原因・理由・要因・背景を書かない。** 手元に会社の説明資料が無いため、\n"
        "  何がその数値をもたらしたかを**知る手段がない**。もっともらしい説明を推測で補わない。\n"
        "  禁止例（いずれも実際に混入した）: 「不採算店舗の整理により」「効率化が奏功し」\n"
        "  「原材料価格の影響を受けやすい事業特性もあり」「〜と推察されます」「〜を示唆しています」。\n"
        "- 「なぜ」を問われたら、**数値上の事実**（どのセグメントがどれだけ動いたか）を示したうえで、\n"
        "  『要因についての会社の説明は、当方が保有する開示資料では確認できませんでした』と述べて終える。\n"
        "- 評価語（好調・堅調・力強い・劇的な等）も使わない。事実の記述に徹する。"
    ),
    insight_rule=(
        "- 本文の最後に「#### 💡 注目ポイント」の見出しで、**数値どうしの対比のみ**を1〜2点添えてよい\n"
        "  （例:「売上構成比は物流が45.3%で最大」「増収率が最も高いのは物流の+31.3%」）。\n"
        "  **原因・評価・含意・将来には触れない。** 対比として述べることが無ければこの節は省略。"
    ),
)


# 読者レベル別の"翻訳"指示（WRITE のみ・内容の専門性は共通）。
# 分析の中身は変えず、説明のかみ砕き方だけを読者に合わせる。
# 2段階: casual（投資1年目・中学生でも読める） / standard（一般的な個人投資家=既定）。
# 3段階（初心者/中級者/上級者）は差が体感できず廃止（旧値は normalize_audience が吸収）。
AUDIENCE_STYLES: dict[str, str] = {
    "casual": (
        "読者は投資1年目の個人（中学生でも読めるやさしさを目指す）。"
        "専門用語は初出時に必ずやさしい言い換えを付ける"
        "（例:「営業利益（本業でどれだけ儲かったか）」「前年比（去年と比べてどれくらい増減したか）」"
        "「会社予想（会社自身が発表した来期の見込み）」）。"
        "身近なたとえ話を積極的に使ってよい（例: 利益率は「100円売って何円残るか」）。"
        "一文は短く、段落も短く、箇条書きを多めに。難しい漢語より話し言葉に近い表現を選ぶ。"
        "ただし分析の内容・数値・事実の正確性は絶対に薄めない（やさしいのは言葉だけ）。"
    ),
    "standard": (
        "読者は一般的な個人投資家。基本用語（売上高・営業利益・前年比など）は注釈不要。"
        "専門的な概念（構成比・利益寄与度など）だけ簡潔に補足する。"
    ),
}
DEFAULT_AUDIENCE = "standard"

# 旧3段階の値からの後方互換マッピング（保存済みクライアント設定・旧UIを壊さない）
_LEGACY_AUDIENCE = {"beginner": "casual", "intermediate": "standard", "advanced": "standard"}


def normalize_audience(audience: str | None) -> str:
    """読者レベルを正規化（旧3段階は新2段階へ、未知値は既定=standard へ）。
    有効値の唯一の正は AUDIENCE_STYLES。normalize_topic と同じ「境界で丸める」パターン。"""
    a = (audience or "").strip()
    a = _LEGACY_AUDIENCE.get(a, a)
    return a if a in AUDIENCE_STYLES else DEFAULT_AUDIENCE


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


def _search_safe(q: str, company: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        return search_disclosures(q, CompanyCtx(company)).get("passages", [])
    except Exception as e:
        _log.warning("retrieve(search) 失敗: %s", e)
        return []


def _dedupe_passages(passages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple] = set()
    out: list[dict[str, Any]] = []
    for p in passages:
        key = (p.get("doc"), p.get("page"), str(p.get("text", ""))[:60])
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def _retrieve(query: str, company: dict[str, Any], ticker: str):
    """決定論 retrieve: 層1データシート＋層2の**2角度並列検索**。
    1本目=質問そのもの、2本目=「背景・要因・会社の説明」角度。最新決算を聞かれても、
    過去の説明資料・IR想定問答に根拠/背景があれば補足材料として同梱する（深掘りの土台）。
    2本は並列実行のためレイテンシは増えない。(facts_ctx, pa, pf, passages, passages_ctx)。"""
    facts_ctx, pa, pf = _facts_context(ticker)
    queries = [query, f"{query} 背景 要因 会社の説明"]
    with ThreadPoolExecutor(max_workers=2) as ex:
        results = list(ex.map(lambda q: _search_safe(q, company), queries))
    passages = _dedupe_passages([p for r in results for p in r])[:_MAX_PASSAGES]
    passages_ctx = (
        "\n".join(
            f"[{i}] doc={p.get('doc')} / {str(p.get('text', ''))[:400]}"
            for i, p in enumerate(passages)
        )
        or "（該当する開示抜粋なし）"
    )
    return facts_ctx, pa, pf, passages, passages_ctx


# 答えられなかったやり取り。**話題を確立させない**（#161）。
_FAILED_SCOPES = {"escalated", "refused"}


def _usable_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    """書き換えに使ってよい履歴だけを残す（#161）。

    **答えられなかったやり取りは落とす。** 残すと、答えられなかった話題を次の質問に
    引きずる。実測（ゲオ 2681）: 「セグメント別の業績」がエスカレした直後に
    「前年と比べて業績はどうですか？」と聞くと、

        書き換え後: ゲオホールディングスの【セグメント別の】業績は、前年と比べてどうですか？

    となり、単体なら答えられる質問まで答えられなくなっていた。ユーザーは失敗したからこそ
    聞き方を変えているのに、システムが元の話題へ引き戻す。会話が長いほど抜け出せない。

    プロンプトに「前のターンが失敗したときは話題を引き継がない」と教える手もあるが採らない。
    この工程は機械的であるべきで、判断をLLMに増やすと同じ形で再発する
    （現に「話題を変えず」という指示が原因になっている）。

    落とすのは失敗した assistant ターンと、**その直前の user ターン**（＝答えられなかった
    質問そのもの）。`scope` を持たない履歴は成功扱い＝旧クライアントと eval は挙動不変。
    """
    out: list[dict[str, str]] = []
    for turn in history:
        if turn.get("role") == "assistant" and str(turn.get("scope") or "") in _FAILED_SCOPES:
            if out and out[-1].get("role") == "user":
                out.pop()
            continue
        out.append(turn)
    return out


def _contextualize(name: str, history: list[dict[str, str]], query: str) -> str:
    """短期メモリ: 会話履歴でフォロー質問を自己完結クエリに書き換える（condense question）。
    履歴が無ければ LLM を呼ばずそのまま返す（eval は履歴なし＝従来と完全に同一挙動）。"""
    history = _usable_history(history or [])
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
        resp = _generate([prompt])
        rewritten = (resp.text or "").strip().splitlines()[0].strip() if resp.text else ""
        # 失敗・空・極端に長い場合は元の質問にフォールバック（安全側）。
        if rewritten and len(rewritten) <= 300:
            if rewritten != query:
                # 本文はログに残さない（Cloud Logging にも会話内容を保持しない方針）
                _log.info(
                    "contextualize: フォロー質問を書き換え（%d→%d文字）", len(query), len(rewritten)
                )
            return rewritten
    except Exception as e:
        _log.warning("contextualize 失敗（元の質問で続行）: %s", e)
    return query


def _parse_plan_json(text: str) -> dict[str, Any]:
    """PLAN応答のJSONを堅牢にパースする。
    gemini-3 は json_mode でも稀にJSONオブジェクトの後へ余分なテキストを付ける
    （json.loads が 'Extra data' で落ちる）。先頭の完全なJSONオブジェクトだけを
    raw_decode で取り出し、後続は無視する（strict=False は本文中の生改行対策）。"""
    s = text.lstrip()
    start = s.find("{")
    if start < 0:
        raise ValueError(f"PLAN応答にJSONが見つかりません: {s[:80]!r}")
    obj, _end = json.JSONDecoder(strict=False).raw_decode(s[start:])
    if not isinstance(obj, dict):
        raise ValueError(f"PLAN応答がオブジェクトではありません: {type(obj).__name__}")
    return obj


def _plan(name: str, query: str, facts_ctx: str, passages_ctx: str) -> dict[str, Any]:
    """PLAN: answerability 判定＋カード指標・引用の選択＋話題分類（構造化JSON）。
    話題は既存のPLAN呼び出しに相乗り＝追加のLLMコール・コストゼロ（タクソノミーから選択のみ）。"""
    prompt = PLAN_PROMPT.format(
        company_name=name,
        query=query,
        facts_context=facts_ctx,
        passages_context=passages_ctx,
        topics=" | ".join(TOPICS),
    )
    resp = _generate([prompt], json_mode=True)
    return _parse_plan_json(resp.text)


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


def _write_stream(
    name, query, facts_ctx, passages_ctx, focus_metrics, audience: str, has_passages: bool
):
    """WRITE: 本文をプレーンテキストでストリーミング生成。チャンクの text を yield。
    audience は説明の"翻訳度"のみ調整（内容の専門性は共通）。
    has_passages は**書いてよいことの範囲**を決める（#151）＝材料が無ければ因果を書かせない。"""
    style = _STYLE_WITH_PASSAGES if has_passages else _STYLE_FACTS_ONLY
    prompt = WRITE_PROMPT.format(
        role=style.role.format(company_name=name),
        causal_rule=style.causal_rule,
        insight_rule=style.insight_rule,
        company_name=name,
        query=query,
        facts_context=facts_ctx,
        passages_context=passages_ctx,
        focus_metrics=", ".join(focus_metrics) or "（主要指標）",
        audience_style=AUDIENCE_STYLES.get(audience, AUDIENCE_STYLES[DEFAULT_AUDIENCE]),
    )
    for chunk in _generate_stream([prompt]):
        t = getattr(chunk, "text", None)
        if t:
            yield t


def _escalate_stream(reason: str, topic: str | None = None, *, can_contact_ir: bool = True):
    """エスカレ応答を stream プロトコルで返す（短文を1回 prose_delta → final）。"""
    resp = _escalate(reason, topic, can_contact_ir=can_contact_ir)
    yield {"type": "prose_delta", "text": resp["answer_prose"]}
    yield {"type": "final", "response": resp}


def synthesize_stream(
    query: str,
    company: dict[str, Any],
    history: list[dict[str, str]] | None = None,
    audience: str = DEFAULT_AUDIENCE,
):
    """生成IR をストリーミング。yield {"type":"prose_delta",...} 群 → {"type":"final",...}。
    CONTEXTUALIZE（フォロー質問の書き換え）→ RETRIEVE → PLAN（判定・接地）→ WRITE（本文をトークン逐次）。
    history が無ければ書き換えをスキップ＝従来と同一挙動。suggestions は agent 側で付与。"""
    ticker = str(company.get("ticker") or "")
    name = company.get("name") or "対象企業"
    # 取り次ぎ先があるか（#145）。**datastore_id から導出しない。**
    # 「層2を持つか」と「発行体と関係があるか」は今は一致しているが、
    # 非顧客企業の定性情報を当方で収集するようになると別々になる。
    # 判定の正はフロント（companies.ts の isCustomerCompany）。
    can_contact_ir = bool(company.get("is_customer"))

    # A1: 進行段階をフロントへ実況（search→plan→write）。待ち時間を"作業が見える"体験にする。
    yield {"type": "status", "stage": "search"}

    # 短期メモリ: 履歴があればフォロー質問を自己完結クエリに書き換えてから retrieve/plan に渡す。
    query = _contextualize(name, history or [], query)

    facts_ctx, pa, pf, passages, passages_ctx = _retrieve(query, company, ticker)

    yield {"type": "status", "stage": "plan"}

    # PLAN（判定）
    try:
        data = _plan(name, query, facts_ctx, passages_ctx)
    except Exception as e:
        _log.warning("synthesize plan 失敗: %s", e)
        yield from _escalate_stream(
            "ただいま回答を生成できませんでした。", can_contact_ir=can_contact_ir
        )
        return

    can_answer = bool(data.get("can_answer"))
    rel_metrics = [m for m in (data.get("relevant_metrics") or []) if isinstance(m, str)]
    used = [i for i in (data.get("used_citations") or []) if isinstance(i, int)]
    # 話題分類（PLAN相乗り）。未知ラベルは「その他」に正規化＝集計の決定論性を守る。
    topic = normalize_topic(str(data.get("topic") or ""))

    # エスカレ時に出す文。**抜粋が無いときはLLMの理由文を採らない**（#151）。
    # 自由文には創作が混じる（実測: 答えられないと言いながら「要因（コスト削減、
    # 不採算店舗の閉鎖など）」と**答えの候補を創作して例示**していた）。
    # 数値と同じ切り分け＝判断はLLM、文言はコード。
    # 材料に応じて文面を決める。**判断はLLM（can_answer）、文言はコード**（#151）。
    #   抜粋あり  → LLMの理由文（資料を読んだうえでの判断なので具体的に書ける）
    #   数値のみ  → 背景が無い旨（`_NO_MATERIAL`）
    #   何も無い  → 取り込んでいない旨（`_NO_FACTS`）。数値があるかのように言わない
    if passages:
        escalate_text = str(data.get("escalate_reason") or "").strip() or _NO_ANSWER
    elif pa or pf:
        # 「無い」だけで終わらせず、**代わりに何が聞けるか**を層1から添える（#162）
        escalate_text = " ".join(filter(None, [_NO_MATERIAL, _available_metrics_line(ticker)]))
    else:
        escalate_text = _NO_FACTS

    if not can_answer:
        yield from _escalate_stream(escalate_text, topic, can_contact_ir=can_contact_ir)
        return

    # GROUND（決定論）。接地ゼロ＝実質未回答 → エスカレ
    fact_cards, citations = _ground(ticker, pa, pf, rel_metrics, used, passages)
    if not fact_cards and not citations:
        yield from _escalate_stream(escalate_text, topic, can_contact_ir=can_contact_ir)
        return

    # WRITE（本文をストリーミング）
    yield {"type": "status", "stage": "write"}
    parts: list[str] = []
    try:
        for t in _write_stream(
            name, query, facts_ctx, passages_ctx, rel_metrics, audience, bool(passages)
        ):
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
            # 内部フィールド（AgentResponse契約外）: agent.py が pop して analytics に記録する
            "topic": topic,
        },
    }


def _escalate(
    reason: str, topic: str | None = None, *, can_contact_ir: bool = True
) -> dict[str, Any]:
    """エスカレ応答。**取り次ぎ先が無い企業に「IR窓口へ」と書かない**（#145）。

    UI側でCTAボタンを消しても本文が「IR窓口へお問い合わせください」のままだと、
    どこに問い合わせればよいのか分からない案内になる（実機で確認）。
    誘導先の有無は同じ事実なので、ボタンと本文で判断を分けない。
    """
    tail = (
        " 恐れ入りますが、IR窓口へお問い合わせください。"
        if can_contact_ir
        else " 会社が公表している資料をご確認ください。"
    )
    msg = f"{_strip_refs(reason)}{tail}"
    return {
        "answer_prose": msg,
        "fact_cards": [],
        "citations": [],
        "scope_status": "escalated",
        "scope_reason": "out_of_corpus",
        # 内部フィールド（AgentResponse契約外）: agent.py が pop して analytics に記録する
        "topic": topic,
    }
