from __future__ import annotations

from flask import Blueprint, jsonify, request

from agent.common.gateway_client import call_market_insight_gateway, call_market_wide_insight_gateway, gateway_configured
from agent.common.json_utils import compact_text
from agent.market_insight import build_market_insight
from agent.market_wide import build_market_wide_insight


def create_agent_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("agent_routes", __name__)

    @bp.route("/agent/market-insights", methods=["POST"])
    def api_market_insights():
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        if gateway_configured() and request.headers.get("X-PolyData-Agent-Gateway-Attempt") != "1":
            try:
                return jsonify(call_market_insight_gateway(payload))
            except Exception as exc:
                local_response = build_market_insight(payload)
                local_response["gatewayFallback"] = True
                local_response["gatewayError"] = compact_text(str(exc), 180)
                return jsonify(local_response)
        return jsonify(build_market_insight(payload))

    @bp.route("/agent/market-wide-insights", methods=["POST"])
    def api_market_wide_insights():
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        if gateway_configured() and request.headers.get("X-PolyData-Agent-Gateway-Attempt") != "1":
            try:
                return jsonify(call_market_wide_insight_gateway(payload))
            except Exception as exc:
                local_response = build_market_wide_insight(payload)
                local_response["gatewayFallback"] = True
                local_response["gatewayError"] = compact_text(str(exc), 180)
                return jsonify(local_response)
        return jsonify(build_market_wide_insight(payload))

    return bp
