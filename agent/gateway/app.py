from __future__ import annotations

import os
from typing import Any

from flask import Flask, jsonify, request

from agent.common.env import get_env
from agent.market_insight import build_market_insight


def _authorized() -> bool:
    expected = get_env("POLYDATA_AGENT_GATEWAY_TOKEN")
    if not expected:
        return True
    bearer = request.headers.get("Authorization", "")
    token = request.headers.get("X-PolyData-Agent-Token", "")
    if bearer.startswith("Bearer "):
        token = bearer.removeprefix("Bearer ").strip()
    return token == expected


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "service": "polydata-agent-gateway"})

    @app.post("/agent/market-insights")
    def market_insights():
        if not _authorized():
            return jsonify({"error": "unauthorized"}), 401
        payload: Any = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        result = build_market_insight(payload)
        result["servedBy"] = "agent-gateway"
        return jsonify(result)

    return app


app = create_app()


def main() -> None:
    host = get_env("POLYDATA_AGENT_GATEWAY_HOST", "127.0.0.1")
    port = int(get_env("POLYDATA_AGENT_GATEWAY_PORT", "18700"))
    debug = os.environ.get("POLYDATA_AGENT_GATEWAY_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()

