"""EDINETコード一覧（提出者マスター）→ 企業マスター（#154）。

書類一覧API（`client.py`）が返すのは**ティッカーと社名だけ**で、`companies.ts` が要る
英語名・業種・決算月が取れなかった。EDINETは提出者マスターを別途公開しているので、
そちらから引く。

    https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip
      鍵不要 / 556KB / 11,374件（うち証券コードあり 3,831社＝上場ほぼ全数）

**推測で埋めない。** 英語名や業種を記憶から書けば、開示に無い情報を創作するのと
同じことになる（実際に一度やって #153 で削除した）。一次情報から機械的に引く。

副産物として法人番号（他の公的データとの結合キー）・連結の有無・資本金・所在地も取れる。

## 実測でわかった注意点

**社名はコード一覧の方が新しい。** コード一覧は現在の登録名、有報の `filerName` は
**提出時点**の名前で、社名変更があるとずれる（実測: 7561 はコード一覧が
「ハークスレイホールディングス」、2026-06-19提出の有報は「ハークスレイ」。
有報の表紙(XBRL)も提出時点の名前）。**どちらも誤りではなく時点が違う**ので、
用途で選ぶ——企業マスターの表示名は最新（コード一覧）、
出典として「その書類の提出者」を示すなら提出時点（有報）が正しい。

**英字名は403社で空。** 必須にはできない。`companies.ts` の `nameEn` は
JSON-LD（公開企業限定）でしか使われないので、空でも支障はない。
"""

from __future__ import annotations

import csv
import io
import re
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

# 鍵不要。EDINET APIのサブスクリプションキーは要らない（書類取得APIとは別系統）。
CODELIST_URL = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"

_MEMBER = "EdinetcodeDlInfo.csv"
_ENCODING = "cp932"  # 実測。utf-8 では読めない

# CSVの列名（実測のヘッダ。全角の「ＥＤＩＮＥＴ」に注意）
_COL = {
    "edinet_code": "ＥＤＩＮＥＴコード",
    "listed": "上場区分",
    "consolidated": "連結の有無",
    "fiscal_end": "決算日",
    "name": "提出者名",
    "name_en": "提出者名（英字）",
    "sector": "提出者業種",
    "sec_code": "証券コード",
    "corporate_number": "提出者法人番号",
}
# 参考: CSVには資本金・所在地・ヨミもある。必要になったらここに足す。

# 「3月31日」「12月20日」など。**日は使わない**（月だけ要る）。
_FISCAL_END = re.compile(r"^(\d{1,2})月")


@dataclass(frozen=True)
class Filer:
    """提出者1件。`companies.ts` に必要な項目に絞って持つ。"""

    edinet_code: str
    ticker: str  # 4桁（証券コードは5桁で来る）
    name: str
    name_en: str
    sector: str
    fiscal_year_end_month: int | None
    corporate_number: str
    consolidated: bool


def _ticker4(sec_code: str) -> str:
    """証券コード5桁 → 4桁。

    EDINETの secCode は末尾に0が付いた5桁（`40630`）。新形式の英数字コード
    （`135A`）にも耐えるよう、末尾除去ではなく先頭4桁を取る（`client.DocRef` と同じ規則）。
    """
    return sec_code.strip()[:4]


def _fiscal_month(text: str) -> int | None:
    """「3月31日」→ 3。読めなければ None（**推測しない**）。"""
    m = _FISCAL_END.match(text.strip())
    if not m:
        return None
    month = int(m.group(1))
    return month if 1 <= month <= 12 else None


def parse(zip_bytes: bytes) -> list[Filer]:
    """コード一覧のzipから**上場企業だけ**を返す。

    絞り込みは**証券コードと上場区分の両方**を見る。片方では足りない（実測）:

        証券コードなし × 上場区分なし      6,272   投信・組合など
        証券コードあり × 上場区分「上場」   3,829   ← 対象
        証券コードなし × 上場区分「非上場」 1,271   有報提出義務のある非上場会社
        証券コードあり × 上場区分「非上場」     2   ← **上場廃止直後など。除く**

    最後の2社は証券コードを持つので、コードだけで絞ると混ざる。
    銘柄URL（`/c/<ticker>`）を持てるのは現に上場している会社だけ。
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        text = zf.read(_MEMBER).decode(_ENCODING)

    rows = list(csv.reader(io.StringIO(text)))
    # 1行目は「ダウンロード実行日 / 件数」のメタ行。2行目がヘッダ。
    header = rows[1]
    idx = {key: header.index(col) for key, col in _COL.items()}

    out: list[Filer] = []
    for r in rows[2:]:
        if len(r) <= max(idx.values()):
            continue
        sec = r[idx["sec_code"]].strip()
        if not sec or r[idx["listed"]].strip() != "上場":
            continue
        out.append(
            Filer(
                edinet_code=r[idx["edinet_code"]].strip(),
                ticker=_ticker4(sec),
                name=r[idx["name"]].strip(),
                name_en=r[idx["name_en"]].strip(),
                sector=r[idx["sector"]].strip(),
                fiscal_year_end_month=_fiscal_month(r[idx["fiscal_end"]]),
                corporate_number=r[idx["corporate_number"]].strip(),
                consolidated=r[idx["consolidated"]].strip() == "有",
            )
        )
    return out


def fetch(cache_dir: Path, *, refresh: bool = False) -> list[Filer]:
    """コード一覧を取得して解析する（ディスクにキャッシュ）。

    日次で更新される類のものではないので、既定ではキャッシュを使い回す。
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "Edinetcode.zip"
    if refresh or not path.exists() or path.stat().st_size == 0:
        with urllib.request.urlopen(CODELIST_URL, timeout=120) as res:  # noqa: S310
            path.write_bytes(res.read())
    return parse(path.read_bytes())


# --------------------------------------------------------------------- 突合
def cross_check(filers: list[Filer], corpus_tickers: set[str]) -> dict[str, list[str]]:
    """企業マスターと層1コーパス（#136の抽出結果）を突合する。

    **黙って欠落させない**（#131 と同じ方針）。片方にしか無い企業は必ず理由が要る:

    - `master_only` — コード一覧にあるが有報を取れていない。
      取得期間外（前年度に提出済み）か、そもそも有報を出していない
    - `corpus_only` — 有報は取れたがコード一覧に無い。**取得後の上場廃止・コード変更**
      （実測21社。提出日は 2025-08 〜 2026-05 で、コード一覧は 2026-08 時点のもの）

    どちらも異常ではないが、件数が跳ねたら取り込みの不具合を疑う手がかりになる。
    """
    master = {f.ticker for f in filers}
    return {
        "master_only": sorted(master - corpus_tickers),
        "corpus_only": sorted(corpus_tickers - master),
        "both": sorted(master & corpus_tickers),
    }
