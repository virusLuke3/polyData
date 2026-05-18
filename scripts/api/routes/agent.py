from __future__ import annotations

from flask import Blueprint, jsonify, request

from agent.market_insight import build_market_insight


def create_agent_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("agent_routes", __name__)

    @bp.route("/agent/market-insights", methods=["POST"])
    def api_market_insights():
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        return jsonify(build_market_insight(payload))

    return bp

