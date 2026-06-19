"""IR Agent 設定（環境変数。本番は Secret Manager / Cloud Run env から注入）。"""

from __future__ import annotations

import os
from pathlib import Path

# agent/.env を読み込む（uvicorn直起動でも GOOGLE_GENAI_USE_VERTEXAI 等を反映）
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"))
except Exception:
    pass

# --- GCP / モデル -----------------------------------------------------------
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "hallowed-trail-462613-v1")
LOCATION = os.environ.get("GCP_LOCATION", "global")  # Discovery Engine
VERTEX_LOCATION = os.environ.get("GCP_VERTEX_AI_LOCATION", "us-central1")

# 既定は現プロジェクトで利用可能な gemini-2.5-flash（gemini-3-* は未開放）。
# .env の MODEL_NAME で上書き可。Gemini 3 開放後に差し替え。
MODEL_NAME = os.environ.get("MODEL_NAME", "gemini-2.5-flash")

# --- リトリーバ（層2） -------------------------------------------------------
# データストアIDは固定しない。リクエストごとに企業コンテキスト(datastore_id)から
# datastore_serving_config() で組み立てる（マルチテナント）。

# --- Cloud SQL（層1: financial_facts）---------------------------------------
DB_INSTANCE_CONNECTION_NAME = os.environ.get(
    "DB_INSTANCE_CONNECTION_NAME",
    "hallowed-trail-462613-v1:us-central1:ir-faq-db",
)
DB_USER = os.environ.get("DB_USER", "ir_app_user")
DB_NAME = os.environ.get("DB_NAME", "ir_faq")
# DB_PASSWORD は Secret Manager から注入（平文で持たない）
DB_PASSWORD = os.environ.get("DB_PASSWORD")

# --- 層1（financial_facts）のバックエンド -----------------------------------
# 'json'  = PoC。構造化JSONファイル（無料・インフラ不要）。
# 'cloudsql' = 本番。Cloud SQL / Postgres（多発行体・大量・同時書込・集計）。
FACTS_BACKEND = os.environ.get("FACTS_BACKEND", "json")
FACTS_JSON_PATH = os.environ.get("FACTS_JSON_PATH", "")  # 空ならパッケージ同梱の既定

# --- 取得パラメータ ----------------------------------------------------------
MAX_DISCLOSURE_RESULTS = int(os.environ.get("MAX_DISCLOSURE_RESULTS", "8"))


def datastore_serving_config(datastore_id: str) -> str:
    """Discovery Engine の servingConfig パスを構築。"""
    return (
        f"projects/{PROJECT_ID}/locations/{LOCATION}"
        f"/collections/default_collection/dataStores/{datastore_id}"
        f"/servingConfigs/default_search"
    )
