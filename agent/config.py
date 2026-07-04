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
# Vertex(Gemini) のロケーション。gemini-3-flash-preview は us-central1 に無く global のみ提供
# のため global を既定に（gemini-2.5-flash も global で動くのでロールバック時も同ロケでよい）。
VERTEX_LOCATION = os.environ.get("GCP_VERTEX_AI_LOCATION", "global")

# gemini-3-flash-preview（global提供）を既定に。eval関門（数値100%/コンプラ0）通過を確認済み。
# ロールバックは MODEL_NAME=gemini-2.5-flash（global で動作確認済み）。素の 'gemini-3-flash' は
# 存在せず 404 になるので使わないこと（実在IDは 'gemini-3-flash-preview'）。
MODEL_NAME = os.environ.get("MODEL_NAME", "gemini-3-flash-preview")

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

# 数値カードの最大表示枚数。広い質問（「業績全般」）で指標×期間が増殖し usability が
# 落ちるのを防ぐ。超過時のみ「各指標を最新実績1枚（YoYバッジ付き）に畳む＋ヘッドライン
# 優先で truncate」する（synthesize._reduce_cards）。狭い質問は無傷＝eval関門に影響なし。
MAX_FACT_CARDS = int(os.environ.get("MAX_FACT_CARDS", "8"))

# --- 回答生成モード ----------------------------------------------------------
# 'synthesis' = Grounded Synthesis（retrieve→統合合成→接地・answerability判定）＝既定
# 'legacy'    = ADK の agentic ツールループ（従来・ロールバック用。ANSWER_MODE=legacy）
ANSWER_MODE = os.environ.get("ANSWER_MODE", "synthesis")

# --- 分析ログ（痛み②: IRインテリジェンス。BigQuery）------------------------
# 全Q&Aを匿名・集計用に記録（個人識別子は持たない）。ローカル/評価では既定OFF。
ANALYTICS_ENABLED = os.environ.get("ANALYTICS_ENABLED", "").upper() in ("1", "TRUE", "YES")
BQ_DATASET = os.environ.get("BQ_DATASET", "ir_analytics")
BQ_TABLE = os.environ.get("BQ_TABLE", "interactions")


def datastore_serving_config(datastore_id: str) -> str:
    """Discovery Engine の servingConfig パスを構築。"""
    return (
        f"projects/{PROJECT_ID}/locations/{LOCATION}"
        f"/collections/default_collection/dataStores/{datastore_id}"
        f"/servingConfigs/default_search"
    )
