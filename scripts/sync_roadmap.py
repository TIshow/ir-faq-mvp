#!/usr/bin/env python3
"""GitHub Issue から `docs/ROADMAP.md` を生成する。

## なぜ生成するのか

**タスクの状態はGitHub Issueが唯一の正**にする。Markdownに状態を書き写すと必ず腐る——
実際 epic #130 の手書きチェックボックスは #131〜#136 が完了しても未チェックのままだった。

ではなぜリポジトリにも置くのか。このプロジェクトは人とAIが交互に触るので、
**リポジトリを読むだけで全体像が掴める**必要がある（`CLAUDE.md` が入口ドキュメントなのと同じ理由）。
GitHubを叩かないと何が残っているか分からない状態は、引き継ぎの摩擦になる。

そこで「正はGitHub・リポジトリには生成されたビューを置く」形にする。
生成物には**生成時刻と再生成コマンド**を書くので、古さが見えるし直せる。

## 使い方

    uv run python scripts/sync_roadmap.py            # docs/ROADMAP.md を更新
    uv run python scripts/sync_roadmap.py --check    # 差分があれば exit 1（CI用）

`gh` CLI の認証が要る（`gh auth status` で確認）。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO = "TIshow/ir-faq-mvp"
OUT = Path(__file__).resolve().parent.parent / "docs" / "ROADMAP.md"

# 優先度ラベル -> (見出し, 説明)。この順に並べる。
PRIORITIES = [
    ("P0-now", "いま／次にやる", "着手中、または次に手を付けるもの"),
    ("P1-next", "近いうちに", "着手条件が揃えばすぐ動かせるもの"),
    ("P2-later", "あとで", "やる価値はあるが今ではないもの"),
]

AREA_LABEL = {
    "area:layer1": "層1（数値）",
    "area:layer2": "層2（引用付き検索）",
    "area:agent": "エージェント",
    "area:ui": "UI/UX",
    "area:infra": "インフラ",
    "area:business": "事業",
}

TYPE_MARK = {
    "type:epic": "epic",
    "type:feat": "feat",
    "type:fix": "fix",
    "type:chore": "chore",
    "type:design": "design",
    "type:strategy": "strategy",
}


def gh_json(*args: str) -> list[dict]:
    """`gh` を叩いてJSONを返す。失敗はそのまま落とす（黙って古い表を出さない）。"""
    out = subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def fetch_open() -> list[dict]:
    return gh_json(
        "issue",
        "list",
        "--repo",
        REPO,
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number,title,labels,updatedAt",
    )


def fetch_recent_closed(limit: int = 15) -> list[dict]:
    return gh_json(
        "issue",
        "list",
        "--repo",
        REPO,
        "--state",
        "closed",
        "--limit",
        str(limit),
        "--json",
        "number,title,closedAt",
    )


def labels_of(issue: dict) -> set[str]:
    return {lb["name"] for lb in issue.get("labels", [])}


def priority_of(issue: dict) -> str | None:
    names = labels_of(issue)
    return next((p for p, _, _ in PRIORITIES if p in names), None)


def render_row(issue: dict) -> str:
    names = labels_of(issue)
    kind = next((TYPE_MARK[t] for t in TYPE_MARK if t in names), "—")
    areas = " / ".join(AREA_LABEL[a] for a in sorted(names) if a in AREA_LABEL) or "—"
    title = issue["title"].replace("|", "｜")
    return f"| [#{issue['number']}](https://github.com/{REPO}/issues/{issue['number']}) | {kind} | {areas} | {title} |"


def render(open_issues: list[dict], closed: list[dict], now: str) -> str:
    lines: list[str] = [
        "# ロードマップ",
        "",
        "> **このファイルは生成物です。直接編集しないでください。**",
        "> タスクの状態の正は GitHub Issue です。ここはリポジトリを読むだけで全体像を掴むためのビュー。",
        "> 再生成: `uv run python scripts/sync_roadmap.py`",
        "",
        f"生成: {now} / open {len(open_issues)}件",
        "",
        "分類は3軸のラベルで付けています（`type:` 何をするか / `area:` どこを触るか / `P0〜P2` いつやるか）。",
        "",
    ]

    for prio, heading, note in PRIORITIES:
        items = [i for i in open_issues if priority_of(i) == prio]
        lines += [f"## {heading}（`{prio}`）", "", note, ""]
        if not items:
            lines += ["なし", ""]
            continue
        lines += ["| Issue | 種類 | 領域 | 内容 |", "|---|---|---|---|"]
        lines += [render_row(i) for i in sorted(items, key=lambda x: -x["number"])]
        lines.append("")

    unlabeled = [i for i in open_issues if priority_of(i) is None]
    if unlabeled:
        # **黙って落とさない。** 優先度が無いIssueは表から消えるので、ここで名指しする。
        lines += [
            "## 優先度ラベルが無い Issue",
            "",
            "上の表に出てきません。`P0-now` / `P1-next` / `P2-later` のどれかを付けてください。",
            "",
        ]
        lines += [
            f"- [#{i['number']}]({'https://github.com/' + REPO + '/issues/'}{i['number']}) {i['title']}"
            for i in unlabeled
        ]
        lines.append("")

    lines += ["## 最近終わったもの", "", "| Issue | 完了日 | 内容 |", "|---|---|---|"]
    for c in closed:
        lines.append(
            f"| [#{c['number']}](https://github.com/{REPO}/issues/{c['number']}) "
            f"| {c['closedAt'][:10]} | {c['title'].replace('|', '｜')} |"
        )
    lines.append("")
    return "\n".join(lines)


_STAMP_PREFIX = "生成: "
_CLOSED_HEADING = "## 最近終わったもの"


def checkable(text: str) -> str:
    """`--check` で比べる部分だけを取り出す。

    落とすもの:

    1. **生成日**。Issueが1件も動いていなくても日付が変われば落ちるので、
       CIが毎日「食い違っています」と言い出す。
    2. **「最近終わったもの」**。ここは直近15件のcloseで毎回変わるため、
       `Closes #N` 付きのPRをマージするたび**次のPRが無関係に落ちる**。
       実際にこのPRで踏んだ（#161/#162 が閉じてズレた）。

    残すのは open Issue の表＝**次に何をやるか**の部分。ここがズレていたら
    本当に直す必要がある（ラベルを変えたのに再生成し忘れた、手で書き換えた等）。
    """
    body = text.split(_CLOSED_HEADING)[0]
    return "\n".join(ln for ln in body.splitlines() if not ln.startswith(_STAMP_PREFIX))


def main() -> int:
    ap = argparse.ArgumentParser(description="GitHub Issue から docs/ROADMAP.md を生成")
    ap.add_argument("--check", action="store_true", help="差分があれば exit 1（生成せず検査だけ）")
    args = ap.parse_args()

    open_issues = fetch_open()
    closed = fetch_recent_closed()
    now = datetime.now(UTC).astimezone().strftime("%Y-%m-%d")
    body = render(open_issues, closed, now)

    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if checkable(current) == checkable(body):
            print("ROADMAP.md は最新です ✅")
            return 0
        print("ROADMAP.md が GitHub と食い違っています ❌")
        print("  → uv run python scripts/sync_roadmap.py で再生成してください")
        return 1

    OUT.write_text(body, encoding="utf-8")
    print(f"{OUT.relative_to(Path.cwd())}: open {len(open_issues)}件 / 最近closed {len(closed)}件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
