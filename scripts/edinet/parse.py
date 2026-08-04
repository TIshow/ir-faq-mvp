"""EDINET XBRL → 層1ファクトの決定論抽出（全社対応版）。

`scripts/extract_facts_xbrl.py` の抽出部を、企業を選ばない形に一般化したもの。
**LLMは一切通さない**。タグと文脈IDから読むだけなので、値の捏造は原理的に起こらない。

1社専用版から一般化するために解いた3点:

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

import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

XLINK = "{http://www.w3.org/1999/xlink}"


def _ln(tag: str) -> str:
    return tag.split("}")[-1]


# --- 連結ヘッドライン: 要素ローカル名 -> (metric_key, 日本語, 単位種別) ------------
# money=円→百万円換算 / yen=そのまま
_MONEY, _YEN = "money", "yen"

HEADLINE_JP: dict[str, tuple[str, str, str]] = {
    "NetSales": ("revenue", "売上高", _MONEY),
    "OperatingIncome": ("operating_profit", "営業利益", _MONEY),
    "OrdinaryIncome": ("ordinary_profit", "経常利益", _MONEY),
    "ProfitLossAttributableToOwnersOfParent": (
        "net_income",
        "親会社株主に帰属する当期純利益",
        _MONEY,
    ),
    "BasicEarningsLossPerShare": ("eps", "1株当たり当期純利益", _YEN),
}

# IFRS採用企業（国内で250社超）。日本基準と要素名が異なる。
HEADLINE_IFRS: dict[str, tuple[str, str, str]] = {
    "RevenueIFRS": ("revenue", "売上収益", _MONEY),
    # IFRSでも売上の要素名は一つではない（実測: KDDI は NetSalesIFRS = 6,071,915百万円）。
    # 同義なので同じ metric_key に寄せる。重複排除は metric_key×period で効く。
    "NetSalesIFRS": ("revenue", "売上高", _MONEY),
    "OperatingProfitLossIFRS": ("operating_profit", "営業利益", _MONEY),
    "ProfitLossBeforeTaxIFRS": ("ordinary_profit", "税引前利益", _MONEY),
    "ProfitLossAttributableToOwnersOfParentIFRS": (
        "net_income",
        "親会社の所有者に帰属する当期利益",
        _MONEY,
    ),
    "BasicEarningsLossPerShareIFRS": ("eps", "基本的1株当たり当期利益", _YEN),
}

SEG_METRICS = {
    "NetSales": ("revenue", "売上高"),
    "OperatingIncome": ("operating_profit", "営業利益"),
    # セグメント損益を営業利益ではなく経常利益で開示する企業が実在するため両対応
    "OrdinaryIncome": ("ordinary_profit", "経常利益"),
    "RevenueIFRS": ("revenue", "売上収益"),
    "OperatingProfitLossIFRS": ("operating_profit", "営業利益"),
}

PERIOD_IDS = {"CurrentYearDuration": "current", "Prior1YearDuration": "prior1"}

# 単体決算の文脈は無次元IDに `_NonConsolidatedMember` が付く。
_NC_SUFFIX = "_NonConsolidatedMember"


def _has_values(root: ET.Element, elements: set[str], *, consolidated: bool) -> bool:
    """指定の要素群が、指定の文脈（連結=無次元 / 単体=_NonConsolidatedMember）に
    実際の**数値**として入っているかどうか。"""
    suffix = "" if consolidated else _NC_SUFFIX
    wanted = {pid + suffix for pid in PERIOD_IDS}
    for el in root.iter():
        if _ln(el.tag) not in elements:
            continue
        text = (el.text or "").strip()
        if text.lstrip("-").isdigit() and (el.get("contextRef") or "") in wanted:
            return True
    return False


def detect_basis(root: ET.Element) -> tuple[str, dict[str, tuple[str, str, str]], bool] | None:
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
    for standard, headline in (("ifrs", HEADLINE_IFRS), ("jp", HEADLINE_JP)):
        if _has_values(root, set(headline), consolidated=True):
            return standard, headline, True
    for standard, headline in (("ifrs", HEADLINE_IFRS), ("jp", HEADLINE_JP)):
        if _has_values(root, set(headline), consolidated=False):
            return standard, headline, False
    return None


# 事業セグメントではないメンバー（合計・単体・調整）。事業として数えると二重計上になる。
_NOT_A_SEGMENT = re.compile(
    r"^(NonConsolidated|ReportableSegments|OperatingSegmentsNotIncludedIn"
    r"|Adjustment|Elimination|Total|Consolidated)"
)
_SEGMENT_SUFFIX = "ReportableSegmentsMember"

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


def _slug(member: str) -> str:
    """メンバー名から安定した英小文字スラグ。提出者接頭辞と接尾辞を落とす。"""
    base = bare_member(member)
    base = base[: -len(_SEGMENT_SUFFIX)] if base.endswith(_SEGMENT_SUFFIX) else base
    return re.sub(r"(?<!^)(?=[A-Z])", "_", base).lower()[:60] or "segment"


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

    # 単体決算のみの企業は、値も文脈IDも `_NonConsolidatedMember` 側に入っている。
    # 期間の解決（enddates）は無次元IDで引くので、対応表を持って読み替える。
    suffix = "" if consolidated else _NC_SUFFIX
    period_ctx = {pid + suffix: pid for pid in PERIOD_IDS}

    labels = segment_labels(zip_path)
    facts: list[dict[str, Any]] = []
    segments: set[str] = set()

    def add(metric_key: str, label: str, period_id: str, raw: str, kind: str) -> None:
        end = enddates.get(period_id)
        if end is None:
            return
        fy = int(end[:4])
        value = int(raw)
        val: float
        if kind == _MONEY:
            # **切り捨て**。日本の開示は百万円単位を切り捨てで表示する慣行で、
            # 四捨五入すると会社自身の決算資料と1ずれる。
            # 実測（ヴィス5071）: 営業利益 1,915,894,000円 → 説明資料は 1915百万円。
            # 四捨五入だと 1916 になり、**出典と食い違う数字を出典つきで出す**ことになる。
            # 「公式資料と一致する」ことが製品価値なので、丸め方は慣行に合わせる。
            # 負値も0方向へ切り捨てる（int() の挙動）＝絶対値を大きくしない。
            val, unit = int(value / 1_000_000), "百万円"
        else:
            val, unit = value, "円"
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
                "verified": False,
            }
        )

    for el in root.iter():
        name = _ln(el.tag)
        cref = el.get("contextRef")
        if not cref or el.text is None:
            continue
        raw = el.text.strip()
        if not raw.lstrip("-").isdigit():
            continue

        # 1) ヘッドライン（当期/前期。連結なら無次元、単体のみの企業なら単体文脈）
        if name in headline and cref in period_ctx:
            mk, label, kind = headline[name]
            add(mk, label, period_ctx[cref], raw, kind)
            continue

        # 2) セグメント（当期/前期 × 報告セグメント）。メンバーは自動検出。
        if name in SEG_METRICS:
            for pid in PERIOD_IDS:
                prefix = pid + suffix + "_"
                if not cref.startswith(prefix) or not cref.endswith(_SEGMENT_SUFFIX):
                    continue
                member = cref[len(prefix) :]
                bare = bare_member(member)
                if _NOT_A_SEGMENT.match(bare):  # 合計・単体・調整は事業ではない
                    continue
                seg_label = labels.get(member) or labels.get(bare)
                if not seg_label:
                    continue  # 日本語名が取れないものは出さない（表示名を推測しない）
                sub, sub_label = SEG_METRICS[name]
                segments.add(seg_label)
                add(
                    f"segment.{_slug(member)}.{sub}",
                    f"{seg_label}（{sub_label}）",
                    pid,
                    raw,
                    _MONEY,
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

    # 単体のみかどうかは detect_consolidated が判定済みなので、ここでの再判定は不要。
    # 値が1件も取れないのは、対象の文脈に該当タグが無かった場合だけになる。
    return ParseResult(
        facts=uniq,
        standard=standard,
        segment_count=len(segments),
        consolidated=consolidated,
        reason=None if uniq else FailReason.NO_VALUES,
    )
