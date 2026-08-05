"""EDINET XBRL → 層1ファクトの決定論抽出（全社対応版）。

**LLMは一切通さない**。タグと文脈IDから読むだけなので、値の捏造は原理的に起こらない。

前身は1社専用の `extract_facts_xbrl.py`（セグメントを手書きで登録する必要があり、
日本基準・連結決め打ち・百万円を四捨五入していた）。同じ出力schemaのまま一般化し、
本モジュールに置き換えた。一般化のために解いた3点:

  1. **セグメントのハードコード廃止**
     セグメントのメンバー名は企業ごとに違う（`jpcrp030000-asr_E05137-000
     MobileCommunicationsAssociatedBusinessReportableSegmentsMember` のように
     提出者IDが接頭辞に入る）。文脈IDから自動検出し、日本語名は同梱の
     `_lab.xml`（ラベルリンクベース）から引く＝表示名も推測しない。

  2. **集計メンバーの除外**
     `ReportableSegmentsMember`（報告セグメント合計）や `NonConsolidatedMember`
     （単体）も同じ形で現れる。これらを事業セグメントとして数えると合計が
     二重計上になるため、明示的に除く。

  3. **会計基準の判定**
     日本基準は `NetSales`/`OperatingIncome`、IFRS は `Revenue`/`OperatingProfitLoss`
     等と要素名が違う。判定できないものは**推測せず未対応として記録**する
     （カバレッジ評価そのものが今回の目的なので、黙って0件にしない）。
"""

from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, NamedTuple

XLINK = "{http://www.w3.org/1999/xlink}"


def _ln(tag: str) -> str:
    return tag.split("}")[-1]


# money=円→百万円換算 / yen=そのまま
_MONEY, _YEN, _RATIO = "money", "yen", "ratio"


class Metric(NamedTuple):
    """XBRL要素をどの層1指標に写すか。tuple のままだと何番目が何か読めない。"""

    key: str  # metric_key（revenue / operating_profit ...）
    label_ja: str  # 表示名
    unit_kind: str  # _MONEY | _YEN | _RATIO


HEADLINE_JP: dict[str, Metric] = {
    "NetSales": Metric("revenue", "売上高", _MONEY),
    "OperatingIncome": Metric("operating_profit", "営業利益", _MONEY),
    "OrdinaryIncome": Metric("ordinary_profit", "経常利益", _MONEY),
    "ProfitLossAttributableToOwnersOfParent": Metric(
        "net_income", "親会社株主に帰属する当期純利益", _MONEY
    ),
    "BasicEarningsLossPerShare": Metric("eps", "1株当たり当期純利益", _YEN),
}

# IFRS採用企業（国内で250社超）。日本基準と要素名が異なる。
HEADLINE_IFRS: dict[str, Metric] = {
    "RevenueIFRS": Metric("revenue", "売上収益", _MONEY),
    # IFRSでも売上の要素名は一つではない（実測: KDDI は NetSalesIFRS = 6,071,915百万円）。
    # 同義なので同じ metric_key に寄せる。重複排除は metric_key×period で効く。
    "NetSalesIFRS": Metric("revenue", "売上高", _MONEY),
    "OperatingProfitLossIFRS": Metric("operating_profit", "営業利益", _MONEY),
    "ProfitLossBeforeTaxIFRS": Metric("ordinary_profit", "税引前利益", _MONEY),
    "ProfitLossAttributableToOwnersOfParentIFRS": Metric(
        "net_income", "親会社の所有者に帰属する当期利益", _MONEY
    ),
    "BasicEarningsLossPerShareIFRS": Metric("eps", "基本的1株当たり当期利益", _YEN),
}

# セグメント指標も**基準ごとに分ける**。混ぜると、IFRS企業の単体（日本基準）側の
# 要素を連結セグメントとして拾いかねない。ヘッドラインと同じ理由。
SEG_METRICS_JP: dict[str, Metric] = {
    "NetSales": Metric("revenue", "売上高", _MONEY),
    "OperatingIncome": Metric("operating_profit", "営業利益", _MONEY),
    # セグメント損益を営業利益ではなく経常利益で開示する企業が実在するため両対応
    "OrdinaryIncome": Metric("ordinary_profit", "経常利益", _MONEY),
}

# IFRSのセグメントは**専用の要素名**を使う（実測: 日立・KDDI）。
# ヘッドラインの要素（RevenueIFRS 等）だけを見ていたため、IFRS 6社中5社で
# セグメントが0件になっていた。
SEG_METRICS_IFRS: dict[str, Metric] = {
    "RevenueIFRS": Metric("revenue", "売上収益", _MONEY),
    "NetSalesIFRS": Metric("revenue", "売上高", _MONEY),
    "RevenueFromExternalCustomersIFRS": Metric("revenue", "外部顧客への売上収益", _MONEY),
    "SalesToExternalCustomersIFRS": Metric("revenue", "外部顧客への売上高", _MONEY),
    "SegmentProfitLossIFRS": Metric("operating_profit", "セグメント利益", _MONEY),
    "OperatingProfitLossIFRS": Metric("operating_profit", "営業利益", _MONEY),
}

SEG_METRICS_BY_STANDARD = {"jp": SEG_METRICS_JP, "ifrs": SEG_METRICS_IFRS}

# 「主要な経営指標等の推移」（有報の冒頭）の要素。**財務諸表本体とは別の要素名**で、
# 本体が当期＋前期しか持たないのに対し**5期ぶん**載っている（#149）。
#
# つまり5年分の層1を作るのに、過去4年ぶんの有報を落とす必要は無い。
# 実測（信越化学 4063・2026年3月期の1ファイル）:
#   Current 2,573,969 / Prior1 2,561,249 / Prior2 2,414,937 / Prior3 2,808,824 / Prior4 2,074,428
#
# **本体と重なる期間（当期・前期）は本体を優先する。** 要約表は百万円単位に丸めて
# 開示されるため生の円値の精度が落ちる（実測: 本体 3,451,913,000 / 要約 3,451,000,000。
# 百万円換算後は同値だが、精度の高い方を正とするのが筋）。
SUMMARY_JP: dict[str, Metric] = {
    "NetSalesSummaryOfBusinessResults": Metric("revenue", "売上高", _MONEY),
    "OrdinaryIncomeLossSummaryOfBusinessResults": Metric("ordinary_profit", "経常利益", _MONEY),
    "NetIncomeLossSummaryOfBusinessResults": Metric("net_income", "当期純利益", _MONEY),
    "BasicEarningsLossPerShareSummaryOfBusinessResults": Metric("eps", "1株当たり当期純利益", _YEN),
    "DividendPaidPerShareSummaryOfBusinessResults": Metric(
        "dividend_per_share", "1株当たり配当額", _YEN
    ),
    "RateOfReturnOnEquitySummaryOfBusinessResults": Metric("roe", "自己資本利益率", _RATIO),
}

# **貸借対照表の項目は「時点(Instant)」の文脈**を使う（損益は「期間(Duration)」）。
# 同じ要約表の中で系統が分かれているので、混ぜると総資産が1件も取れない
# （実測: Duration だけ見ていて total_assets が 0% だった）。
SUMMARY_INSTANT_JP: dict[str, Metric] = {
    "TotalAssetsSummaryOfBusinessResults": Metric("total_assets", "総資産", _MONEY),
    "NetAssetsSummaryOfBusinessResults": Metric("net_assets", "純資産", _MONEY),
    "NetAssetsPerShareSummaryOfBusinessResults": Metric("bps", "1株当たり純資産", _YEN),
    "EquityToAssetRatioSummaryOfBusinessResults": Metric("equity_ratio", "自己資本比率", _RATIO),
}

SUMMARY_IFRS: dict[str, Metric] = {
    "RevenueIFRSSummaryOfBusinessResults": Metric("revenue", "売上収益", _MONEY),
    "ProfitLossBeforeTaxIFRSSummaryOfBusinessResults": Metric(
        "ordinary_profit", "税引前利益", _MONEY
    ),
    "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults": Metric(
        "net_income", "親会社の所有者に帰属する当期利益", _MONEY
    ),
    "BasicEarningsLossPerShareIFRSSummaryOfBusinessResults": Metric(
        "eps", "基本的1株当たり当期利益", _YEN
    ),
}

SUMMARY_INSTANT_IFRS: dict[str, Metric] = {
    "TotalAssetsIFRSSummaryOfBusinessResults": Metric("total_assets", "総資産", _MONEY),
    "EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults": Metric(
        "net_assets", "親会社の所有者に帰属する持分", _MONEY
    ),
    "EquityToAssetRatioIFRSSummaryOfBusinessResults": Metric(
        "equity_ratio", "親会社所有者帰属持分比率", _RATIO
    ),
}

# **提出会社（単体）文脈にしか存在しない指標。**
#
# 1株当たり配当額は法的に「提出会社が支払うもの」なので、連結という概念が無く
# 連結企業でも `_NonConsolidatedMember` 側にしか出ない（実測: 4063 / 7561 / 6501 すべて）。
#
# **これらだけを単体文脈から拾う。** 要約表を丸ごと両文脈から拾うと、連結企業に
# 単体の数字が混ざる（実測: ハークスレイの当期純利益が 1,483 → 647百万円 に化けた。
# 親会社株主に帰属する当期純利益 vs 提出会社単体の当期純利益）。
# #132 で武田薬品を誤ったのと同じ事故なので、対象を指標単位で絞る。
_FILER_ONLY_METRICS = {"dividend_per_share"}

SUMMARY_BY_STANDARD = {"jp": SUMMARY_JP, "ifrs": SUMMARY_IFRS}
SUMMARY_INSTANT_BY_STANDARD = {"jp": SUMMARY_INSTANT_JP, "ifrs": SUMMARY_INSTANT_IFRS}

# 本体は当期＋前期しか持たない。要約表（SUMMARY_*）は Prior2〜4 も持つ。
PERIOD_IDS = {"CurrentYearDuration": "current", "Prior1YearDuration": "prior1"}
SUMMARY_PERIOD_IDS = {
    **PERIOD_IDS,
    "Prior2YearDuration": "prior2",
    "Prior3YearDuration": "prior3",
    "Prior4YearDuration": "prior4",
}
# 貸借対照表側（時点）。期末日は Duration と同じ日付になる。
SUMMARY_INSTANT_IDS = {
    "CurrentYearInstant": "current",
    "Prior1YearInstant": "prior1",
    "Prior2YearInstant": "prior2",
    "Prior3YearInstant": "prior3",
    "Prior4YearInstant": "prior4",
}

# 単体決算の文脈は無次元IDに `_NonConsolidatedMember` が付く。
_NC_SUFFIX = "_NonConsolidatedMember"

# XBRLの数値。**整数だけを見てはいけない。**
# 1株当たり指標や比率は小数で入る（実測: ハークスレイのEPSは `80.24`、ROEは `0.104`）。
# 以前は `str.isdigit()` で判定しており、**小数のファクトが1件も通っていなかった**
# （#146 で「EPSがマップ未登録」と診断した件の真因はこれ）。
_NUMERIC = re.compile(r"^-?\d+(\.\d+)?$")


def _headline_hits(root: ET.Element) -> set[tuple[str, bool]]:
    """(基準, 連結か) の組で、ヘッドラインの**数値**が実在するものを返す。

    XBRLは大きい（実測: 日立 7.4MB）ので、判定のために何度も走査しない。
    **1回の走査で全パターンを集める**。
    """
    ctx_consolidated = {pid: True for pid in PERIOD_IDS}
    ctx_consolidated |= {pid + _NC_SUFFIX: False for pid in PERIOD_IDS}
    by_standard = {"jp": set(HEADLINE_JP), "ifrs": set(HEADLINE_IFRS)}

    hits: set[tuple[str, bool]] = set()
    for el in root.iter():
        consolidated = ctx_consolidated.get(el.get("contextRef") or "")
        if consolidated is None:
            continue
        text = (el.text or "").strip()
        if not _NUMERIC.match(text):
            continue
        name = _ln(el.tag)
        for standard, elements in by_standard.items():
            if name in elements:
                hits.add((standard, consolidated))
    return hits


def detect_basis(root: ET.Element) -> tuple[str, dict[str, Metric], bool] | None:
    """**会計基準と連結/単体を同時に**判定する（#132 / #133）。

    この2つは同じ問い——「**どのタグ群が主たる財務諸表を担っているか**」——なので、
    別々に判定してはいけない。分けたことで実際に事故を起こした（下記）。

    ## 要素の「存在」で基準を判定してはいけない

    **IFRS採用企業でも、有報の親会社単独（単体）の財務諸表は日本基準で作られる。**
    そのため IFRS 企業の XBRL にも `NetSales` 等が単体文脈に存在する。

    実測（武田薬品 4502）:
        NetSales @ CurrentYearDuration_NonConsolidatedMember = 591,604百万円  ← 単体
        RevenueIFRS @ CurrentYearDuration                    = 4,505,720百万円 ← 連結の実数

    存在だけで見ると「日本基準」と誤断定し、続く連結判定が無次元に値を見つけられず
    「単体のみ」に落ちて、**親会社単独の59万百万円を全社の売上高として出力**していた。
    値の捏造ではないが**意味がまったく違う数字**で、`CLAUDE.md` の背骨に反する。

    ## 正しい判定

    「値がどの (基準 × 文脈) に入っているか」で決める。優先順位:

      1. IFRS × 連結（無次元）   → 主たる財務諸表がIFRS連結
      2. 日本基準 × 連結（無次元） → 主たる財務諸表が日本基準連結
      3. IFRS × 単体            → 稀だが一応拾う
      4. 日本基準 × 単体         → 連結を作らない企業（実測10%）

    どれにも当たらなければ **None**（推測しない）。
    """
    hits = _headline_hits(root)
    headlines = {"ifrs": HEADLINE_IFRS, "jp": HEADLINE_JP}
    for consolidated in (True, False):  # 連結を優先（単体は連結が無い企業だけ）
        for standard in ("ifrs", "jp"):  # IFRSを優先（下記の理由）
            if (standard, consolidated) in hits:
                return standard, headlines[standard], consolidated
    return None


# 事業セグメントではないメンバー（合計・単体・調整）。事業として数えると二重計上になる。
_NOT_A_SEGMENT = re.compile(
    r"^(NonConsolidated|ReportableSegments|OperatingSegmentsNotIncludedIn"
    r"|Adjustment|Elimination|Total|Consolidated)"
)
# 報告セグメントのメンバー名の接尾辞。**単複の揺れがある**（実測: ハークスレイ等は
# 複数形 ReportableSegmentsMember、日立は単数形 ReportableSegmentMember）。
# 片方だけで判定すると、ラベルは取れているのにセグメントが0件になる。
_SEGMENT_SUFFIXES = ("ReportableSegmentsMember", "ReportableSegmentMember")


def _strip_segment_suffix(name: str) -> str | None:
    """報告セグメントのメンバーなら接尾辞を除いた名前を、そうでなければ None。"""
    for suffix in _SEGMENT_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return None


# 提出者接頭辞（jpcrp030000-asr_E05137-000）を落として素の要素名にする。
# **文脈IDとラベル定義で区切りが違う**（文脈=`-000Mobile...` / ラベル=`-000_Mobile...`）ため、
# 素の名前に正規化してから突き合わせる。両者で同じ関数を使い、ズレを構造的に防ぐ。
_PREFIX = re.compile(r"^[A-Za-z0-9\-]+_E\d+-\d+_?")


def bare_member(name: str) -> str:
    """メンバー名から提出者接頭辞を除いた素の名前。"""
    return _PREFIX.sub("", name)


class FailReason(StrEnum):
    """抽出できなかった理由（#131）。

    「0件でした」で片付けると、IFRS未対応なのか様式違いなのか本当にタグが無いのかが
    区別できず、カバレッジの意味が読めない。**対処が異なるものは別の値にする**。
    """

    NO_PUBLIC_XBRL = "public_xbrl_なし"  # zip に PublicDoc の .xbrl が無い
    # どの (基準 × 文脈) にも値が無い。単体のみの企業は detect_basis が正常系として
    # 扱うので、ここには来ない（#133 で解決済み）。
    UNKNOWN_STANDARD = "会計基準_判定不能"
    NO_VALUES = "該当タグに数値なし"  # 基準は判ったが値が取れない（真の未対応）


@dataclass
class ParseResult:
    """1書類の抽出結果。失敗も「なぜ」を持って返す（黙って空にしない）。"""

    facts: list[dict[str, Any]] = field(default_factory=list)
    standard: str = "unknown"  # jp | ifrs | unknown
    segment_count: int = 0
    consolidated: bool | None = None  # True=連結 / False=単体のみ / None=判定不能
    reason: FailReason | None = None  # None なら成功


def _context_enddates(root: ET.Element) -> dict[str, str]:
    """context id -> 期末日。ElementTree は `{*}` を解さないのでローカル名で判定する。"""
    out: dict[str, str] = {}
    for ctx in root.iter():
        if _ln(ctx.tag) != "context":
            continue
        cid = ctx.get("id")
        if not cid:
            continue
        end = inst = None
        for child in ctx.iter():
            name = _ln(child.tag)
            if name == "endDate" and child.text:
                end = child.text.strip()
            elif name == "instant" and child.text:
                inst = child.text.strip()
        if end or inst:
            out[cid] = end or inst
    return out


def segment_labels(zip_path: Path) -> dict[str, str]:
    """`_lab.xml` から「要素名 -> 日本語ラベル」を作る。

    ラベルは冗長版（「〜、報告セグメント [メンバー]」）も定義されているので、
    **最も短いものを採用**する（＝素の事業名）。表示名を推測で作らないための措置。
    """
    labels: dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as zf:
        names = [
            n for n in zf.namelist() if n.startswith("XBRL/PublicDoc/") and n.endswith("_lab.xml")
        ]
        if not names:
            return labels
        root = ET.fromstring(zf.read(names[0]))

    texts: dict[str, str] = {}
    locs: dict[str, str] = {}
    arcs: list[tuple[str, str]] = []
    for e in root.iter():
        name = _ln(e.tag)
        if name == "label":
            lid = e.get(XLINK + "label")
            if lid and e.text:
                texts[lid] = e.text.strip()
        elif name == "loc":
            href = e.get(XLINK + "href") or ""
            lid = e.get(XLINK + "label")
            if lid:
                locs[lid] = href.split("#")[-1]
        elif name == "labelArc":
            arcs.append((e.get(XLINK + "from") or "", e.get(XLINK + "to") or ""))

    for frm, to in arcs:
        element, text = locs.get(frm), texts.get(to)
        if not element or not text:
            continue
        for key in (element, bare_member(element)):
            prev = labels.get(key)
            if prev is None or len(text) < len(prev):
                labels[key] = text
    return labels


# slug の最大長。metric_key は識別子であって表示名ではない（表示は metric_label_ja）ので、
# 読みやすさのための上限にすぎない。長さより**一意性**が優先される。
_SLUG_MAX = 60


def _slug(member: str) -> str:
    """メンバー名から安定した英小文字スラグ。提出者接頭辞と接尾辞を落とす。

    メンバー名だけから決まる純関数なので、同じ有報を何度流しても同じ slug になる。

    **切り詰めるときはハッシュを付ける。** 単に先頭を残すだけだと、先頭が同じ長い
    事業名を持つ2事業が同一キーに潰れ、別の事業の数値が静かに混ざる。
    実測（231社）では衝突0件だが、既に上限に達した企業が居る
    （5941=`manufacturing_and_sales_of_general_commercial_kitchen_equipm`＝
    "equipment" が途中で切れている）ので、3,900社では起こりうる。
    """
    base = bare_member(member)
    base = _strip_segment_suffix(base) or base
    slug = re.sub(r"(?<!^)(?=[A-Z])", "_", base).lower()
    if len(slug) > _SLUG_MAX:
        # 組み込み hash() は実行ごとに変わる（PYTHONHASHSEED）ので使わない。
        digest = hashlib.sha1(slug.encode("utf-8")).hexdigest()[:6]
        slug = f"{slug[: _SLUG_MAX - len(digest) - 1]}_{digest}"
    return slug or "segment"


def extract(
    xbrl_bytes: bytes,
    zip_path: Path,
    *,
    ticker: str,
    doc_label: str,
    source_url: str = "",
) -> ParseResult:
    """XBRLインスタンスから層1ファクトを抽出する。"""
    root = ET.fromstring(xbrl_bytes)
    enddates = _context_enddates(root)

    basis = detect_basis(root)
    if basis is None:
        # どの (基準 × 文脈) にも値が無い。**推測でラベルを付けない**。
        return ParseResult(reason=FailReason.UNKNOWN_STANDARD)
    standard, headline, consolidated = basis
    seg_metrics = SEG_METRICS_BY_STANDARD[standard]
    summary = SUMMARY_BY_STANDARD[standard]
    summary_bs = SUMMARY_INSTANT_BY_STANDARD[standard]

    # 単体決算のみの企業は、値も文脈IDも `_NonConsolidatedMember` 側に入っている。
    # 期間の解決（enddates）は無次元IDで引くので、対応表を持って読み替える。
    #
    # 「主要な経営指標等の推移」は**連結と提出会社の2表**が同じ要素で出る
    # （実測120社: 無次元 964件 / 単体文脈 1,047件）。連結企業に単体側を混ぜると
    # 数字の意味が変わるので、ここでも同じ suffix で読み分ける。
    suffix = "" if consolidated else _NC_SUFFIX
    period_ctx = {pid + suffix: pid for pid in PERIOD_IDS}

    # 「主要な経営指標等の推移」。損益は期間(Duration)、貸借は時点(Instant)で系統が違う。
    # 通常はその企業の主たる文脈（連結なら無次元）から、提出会社限定の指標だけは
    # 連結企業でも単体文脈から拾う。
    # 値は**無次元の文脈ID**にする（`add()` が期末日を `enddates` から引くため。
    # ラベルを入れると期末日が引けず黙って全件落ちる）。
    def _ctx(ids: dict[str, str], sfx: str) -> dict[str, str]:
        return {pid + sfx: pid for pid in ids}

    # (指標マップ, 通常の文脈, 提出会社限定の文脈) の組。**2系統を同じ形で扱う**——
    # 片方だけ提出会社対応を書くと、貸借側に配当のような指標を足したとき静かに落ちる。
    summary_tables = (
        (summary, _ctx(SUMMARY_PERIOD_IDS, suffix), _ctx(SUMMARY_PERIOD_IDS, _NC_SUFFIX)),
        (summary_bs, _ctx(SUMMARY_INSTANT_IDS, suffix), _ctx(SUMMARY_INSTANT_IDS, _NC_SUFFIX)),
    )

    labels = segment_labels(zip_path)
    facts: list[dict[str, Any]] = []
    segments: set[str] = set()

    def add(metric_key: str, label: str, period_id: str, raw: str, kind: str) -> None:
        # 単体決算のみの企業は、**無次元の文脈がそもそも定義されていない**ことがある
        # （実測 9204: Prior2〜4 は `_NonConsolidatedMember` 側にしか無い）。
        # 期末日が引けないと期が決まらず、5期あるのに2期しか出ないという落ち方をする。
        end = enddates.get(period_id) or enddates.get(period_id + suffix)
        if end is None:
            return
        fy = int(end[:4])
        value = float(raw)
        val: float
        if kind == _MONEY:
            # **切り捨て**。日本の開示は百万円単位を切り捨てで表示する慣行で、
            # 四捨五入すると会社自身の決算資料と1ずれる。
            # 実測（ヴィス5071）: 営業利益 1,915,894,000円 → 説明資料は 1915百万円。
            # 四捨五入だと 1916 になり、**出典と食い違う数字を出典つきで出す**ことになる。
            # 「公式資料と一致する」ことが製品価値なので、丸め方は慣行に合わせる。
            # 負値も0方向へ切り捨てる（int() の挙動）＝絶対値を大きくしない。
            val, unit = int(value / 1_000_000), "百万円"
        elif kind == _RATIO:
            # 自己資本比率・ROE は XBRL では小数（0.412）で入る。表示は % に揃える
            # （既存の派生指標カードが % なので、単位が混ざらないようにする）。
            val, unit = round(value * 100, 1), "%"
        else:
            # 1株当たり指標は小数を保つ（EPS 80.24 を 80 にすると出典と食い違う）
            val, unit = (int(value) if value == int(value) else round(value, 2)), "円"
        facts.append(
            {
                "ticker": ticker,
                "metric_key": metric_key,
                "metric_label_ja": label,
                "period_label": f"{fy}FY",
                "fiscal_year": fy,
                "fiscal_quarter": None,
                "value_numeric": val,
                "unit": unit,
                "consolidated": consolidated,
                "is_forecast": False,
                "source_doc_label": doc_label,
                "source_url": source_url,
                "source_page": None,
                "source_quote": f"{label} {val}{unit}（XBRL {period_id}, end={end}）",
                # **出所**（#145）。`verified` を立てないのは、これが「人が原本と
                # 突き合わせた」という別の主張だから。XBRLはタグから読むだけで
                # 値の読み違えが起こらないので、検証すべきは企業ではなく抽出器になる
                # （docs/edinet-ingest.md §6-3）。両者は表示もコンプラ上の姿勢も
                # 変わるので、片方に潰さず分けて持つ。
                "source_kind": "xbrl",
                "verified": False,
            }
        )

    for el in root.iter():
        name = _ln(el.tag)
        cref = el.get("contextRef")
        if not cref or el.text is None:
            continue
        raw = el.text.strip()
        if not _NUMERIC.match(raw):
            continue

        # 1) ヘッドライン（当期/前期。連結なら無次元、単体のみの企業なら単体文脈）
        if name in headline and cref in period_ctx:
            m = headline[name]
            add(m.key, m.label_ja, period_ctx[cref], raw, m.unit_kind)
            continue

        # 1') 「主要な経営指標等の推移」（#149）。本体が持たない**前々期〜4期前**を埋める。
        #     本体と重なる期間もここに出るが、後段の重複排除で**先に入った本体が残る**
        #     （要約表は百万円に丸めて開示されるので精度が落ちる）。
        matched = False
        for table, normal_ctx, filer_ctx in summary_tables:
            m = table.get(name)
            if m is None:
                continue
            ctx = filer_ctx if m.key in _FILER_ONLY_METRICS else normal_ctx
            if cref in ctx:
                add(m.key, m.label_ja, ctx[cref], raw, m.unit_kind)
                matched = True
            break
        if matched:
            continue

        # 2) セグメント（当期/前期 × 報告セグメント）。メンバーは自動検出。
        if name in seg_metrics:
            for pid in PERIOD_IDS:
                prefix = pid + suffix + "_"
                if not cref.startswith(prefix):
                    continue
                member = cref[len(prefix) :]
                bare = bare_member(member)
                if _strip_segment_suffix(bare) is None:  # 報告セグメント以外の軸
                    continue
                if _NOT_A_SEGMENT.match(bare):  # 合計・単体・調整は事業ではない
                    continue
                seg_label = labels.get(member) or labels.get(bare)
                if not seg_label:
                    continue  # 日本語名が取れないものは出さない（表示名を推測しない）
                m = seg_metrics[name]
                segments.add(seg_label)
                add(
                    f"segment.{_slug(member)}.{m.key}",
                    f"{seg_label}（{m.label_ja}）",
                    pid,
                    raw,
                    m.unit_kind,
                )

    # 重複排除（同一 metric×period が複数コンテキストで一致した場合の保険）
    seen: set[tuple[str, str]] = set()
    uniq: list[dict[str, Any]] = []
    for f in facts:
        key = (f["metric_key"], f["period_label"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)

    # detect_basis が (基準 × 連結/単体) を確定済みなので、ここでの再判定は不要。
    # 値が1件も取れないのは、その文脈に該当タグが無かった場合だけ。
    return ParseResult(
        facts=uniq,
        standard=standard,
        segment_count=len(segments),
        consolidated=consolidated,
        reason=None if uniq else FailReason.NO_VALUES,
    )
