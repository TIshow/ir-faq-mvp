"""EDINET API v2 クライアント（取得のみ・解析はしない）。

金融庁 EDINET の書類一覧APIと書類取得APIを叩く。**APIは無料だがサブスクリプション
キーが必須**（キー無しは401）。キーは `.env.local` の `EDINET_API`（gitignore済み）。

設計上の約束:
  - **キャッシュ優先**: 一度落としたzipは再取得しない。1年分＝約3,900件を何度も
    流し直すので、再実行が安いことが実装の前提になる。
  - **レート制限**: 相手は官公庁の公開APIなので、既定で1秒あたり2件までに抑える。
  - **失敗しても止めない**: 1社の失敗で全体を落とさず、理由を記録して次へ進む
    （どの企業がなぜ取れなかったかは、カバレッジ評価そのものになる）。
"""

from __future__ import annotations

import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

API_BASE = "https://api.edinet-fsa.go.jp/api/v2"

# 有価証券報告書。半期(160)や訂正(130)は今回の対象外（まず1年分の本体で評価する）。
DOC_TYPE_ANNUAL = "120"


def load_api_key(env_file: str = ".env.local") -> str:
    """APIキーを取得する。環境変数 > .env.local の順。値はログに出さないこと。"""
    key = os.environ.get("EDINET_API")
    if key:
        return key.strip()
    p = Path(env_file)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith("EDINET_API="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError(
        "EDINET_API が見つかりません。.env.local に EDINET_API=<キー> を設定してください。"
    )


@dataclass(frozen=True)
class DocRef:
    """取得対象の書類1件（一覧APIのメタデータから必要な分だけ持つ）。"""

    doc_id: str
    sec_code: str  # EDINETは5桁（例 75610）
    filer_name: str
    doc_description: str
    submit_date: str

    @property
    def ticker(self) -> str:
        """証券コード4桁。EDINETの secCode は末尾に0が付いた5桁で来る。

        新形式の英数字コード（例 135A）にも耐えるよう、末尾除去ではなく先頭4桁を取る。
        """
        return self.sec_code[:4]


class EdinetClient:
    def __init__(
        self,
        api_key: str,
        cache_dir: Path,
        *,
        min_interval_sec: float = 0.5,
        timeout_sec: int = 120,
    ) -> None:
        self._key = api_key
        self.cache_dir = cache_dir
        self.list_dir = cache_dir / "lists"
        self.zip_dir = cache_dir / "zips"
        self.list_dir.mkdir(parents=True, exist_ok=True)
        self.zip_dir.mkdir(parents=True, exist_ok=True)
        self._min_interval = min_interval_sec
        self._timeout = timeout_sec
        self._last_call = 0.0

    # ------------------------------------------------------------------ 内部
    def _throttle(self) -> None:
        wait = self._min_interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

    def _get(self, url: str) -> bytes:
        self._throttle()
        req = urllib.request.Request(url, headers={"Ocp-Apim-Subscription-Key": self._key})
        with urllib.request.urlopen(req, timeout=self._timeout) as res:  # noqa: S310
            return res.read()

    # ------------------------------------------------------------------ 一覧
    def list_documents(self, day: date) -> list[dict[str, Any]]:
        """その日の提出書類一覧。ディスクにキャッシュし、2回目以降はAPIを叩かない。"""
        import json

        cached = self.list_dir / f"{day.isoformat()}.json"
        if cached.exists():
            return json.loads(cached.read_text(encoding="utf-8")).get("results") or []

        q = urllib.parse.urlencode({"date": day.isoformat(), "type": "2"})
        body = self._get(f"{API_BASE}/documents.json?{q}")
        cached.write_bytes(body)
        return json.loads(body.decode("utf-8")).get("results") or []

    def iter_annual_reports(self, start: date, end: date) -> Iterator[DocRef]:
        """期間内の**上場企業の有価証券報告書（XBRL付き）**だけを返す。

        1日の提出書類は数百件あるが、その大半は臨時報告書・大量保有報告書・投信関連。
        有報かつ上場（secCodeあり）かつXBRL添付、の3条件で絞る。
        """
        day = start
        while day <= end:
            for r in self.list_documents(day):
                if not r:
                    continue
                if r.get("docTypeCode") != DOC_TYPE_ANNUAL:
                    continue
                if r.get("xbrlFlag") != "1":
                    continue
                sec = r.get("secCode")
                if not sec:  # 非上場（有報提出義務のある非上場会社）は対象外
                    continue
                yield DocRef(
                    doc_id=r["docID"],
                    sec_code=sec,
                    filer_name=r.get("filerName") or "",
                    doc_description=r.get("docDescription") or "",
                    submit_date=(r.get("submitDateTime") or "")[:10],
                )
            day += timedelta(days=1)

    # ------------------------------------------------------------------ 本体
    def fetch_zip(self, doc_id: str) -> Path:
        """XBRL一式のzipを取得（キャッシュ済みならそれを返す）。"""
        path = self.zip_dir / f"{doc_id}.zip"
        if path.exists() and path.stat().st_size > 0:
            return path
        body = self._get(f"{API_BASE}/documents/{doc_id}?type=1")
        path.write_bytes(body)
        return path

    @staticmethod
    def public_xbrl_name(zip_path: Path) -> str | None:
        """zip内の**提出本文**XBRLインスタンス名を返す。

        `AuditDoc/`（監査報告書）にも .xbrl があるので必ず `PublicDoc/` に限定する。
        ここを間違えると財務数値ではなく監査意見を読みにいくことになる。
        """
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                if name.startswith("XBRL/PublicDoc/") and name.endswith(".xbrl"):
                    return name
        return None

    @staticmethod
    def read_public_xbrl(zip_path: Path) -> bytes | None:
        name = EdinetClient.public_xbrl_name(zip_path)
        if not name:
            return None
        with zipfile.ZipFile(zip_path) as zf:
            return zf.read(name)
