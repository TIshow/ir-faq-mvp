"""
IR Agent ストリーミングHTTPサーバ（FastAPI）。

Next.js の /api/chat から呼ぶ。SSE(Server-Sent Events)で:
  - event: delta   → {"text": "..."}            （prose を逐次。体感速度 Q4）
  - event: final   → AgentResponse 全体           （fact_cards/citations/scope_status）

起動:
  uv run uvicorn agent.server:app --port 8080
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agent import run_agent_stream
from .synthesize import normalize_audience

app = FastAPI(title="IR Agent")


class Turn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class ChatRequest(BaseModel):
    message: str
    # 企業コンテキスト（フロントの companies.ts が唯一の正・ハードコードしない）
    companyTicker: str
    companyName: str = "対象企業"
    datastoreId: str | None = None
    sessionId: str = "s1"
    userId: str = "anon"
    # 短期メモリ: 直近の会話履歴（フォロー質問の書き換え用）。サーバはステートレス。
    history: list[Turn] = []
    # 読者レベル（説明の翻訳度のみ調整。既定=中級者。未知値は中級者へ丸める）
    audience: str = "intermediate"


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    company = {
        "ticker": req.companyTicker,
        "name": req.companyName,
        "datastore_id": req.datastoreId,
    }

    history = [{"role": t.role, "content": t.content} for t in req.history]
    audience = normalize_audience(req.audience)  # 有効値の正は synthesize.AUDIENCE_STYLES

    async def gen():
        try:
            async for chunk in run_agent_stream(
                req.message,
                company,
                user_id=req.userId,
                session_id=req.sessionId,
                history=history,
                audience=audience,
            ):
                if chunk["type"] == "prose_delta":
                    yield _sse("delta", {"text": chunk["text"]})
                elif chunk["type"] == "status":  # A1: 進行段階の実況（search/plan/write）
                    yield _sse("status", {"stage": chunk["stage"]})
                elif chunk["type"] == "final":
                    yield _sse("final", chunk["response"])
        except Exception as e:  # 失敗も前進: ユーザーに丁寧なエラー＋ログ
            yield _sse(
                "final",
                {
                    "answer_prose": "申し訳ありません。ただいま回答できませんでした。",
                    "fact_cards": [],
                    "citations": [],
                    "scope_status": "escalated",
                    "scope_reason": "unknown",
                    "error": str(e),
                },
            )

    return StreamingResponse(gen(), media_type="text/event-stream")
