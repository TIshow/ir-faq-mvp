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

app = FastAPI(title="IR Agent")


class ChatRequest(BaseModel):
    message: str
    # 企業コンテキスト（フロントの companies.ts が唯一の正・ハードコードしない）
    companyTicker: str
    companyName: str = "対象企業"
    datastoreId: str | None = None
    sessionId: str = "s1"
    userId: str = "anon"


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    company = {"ticker": req.companyTicker, "name": req.companyName, "datastore_id": req.datastoreId}

    async def gen():
        try:
            async for chunk in run_agent_stream(
                req.message, company, user_id=req.userId, session_id=req.sessionId
            ):
                if chunk["type"] == "prose_delta":
                    yield _sse("delta", {"text": chunk["text"]})
                elif chunk["type"] == "final":
                    yield _sse("final", chunk["response"])
        except Exception as e:  # 失敗も前進: ユーザーに丁寧なエラー＋ログ
            yield _sse("final", {
                "answer_prose": "申し訳ありません。ただいま回答できませんでした。",
                "fact_cards": [], "citations": [],
                "scope_status": "escalated", "scope_reason": "unknown",
                "error": str(e),
            })

    return StreamingResponse(gen(), media_type="text/event-stream")
