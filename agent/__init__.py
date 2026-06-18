"""IR Agent (ADK) package.

注: ここで agent.py（google.adk 依存）を import しない。
層1（facts_store）やツールを GCP/ADK 無しでローカル検証できるようにするため。
エージェント本体は `agent.agent:root_agent` / サーバは `agent.server:app` を参照する。
"""
