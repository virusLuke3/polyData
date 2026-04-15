from __future__ import annotations

from flask import Blueprint, jsonify, request


def create_content_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("content_routes", __name__)

    @bp.route("/content/market/<int:market_id>", methods=["GET"])
    def api_content_by_market_id(market_id: int):
        market = helpers["get_market_by_id"](market_id)
        if not market:
            return jsonify({"error": "Market not found", "marketId": market_id}), 404
        limit = min(20, max(1, int(request.args.get("limit", 8))))
        return jsonify(helpers["get_related_content_payload"](market_id, limit=limit))

    @bp.route("/content/latest", methods=["GET"])
    def api_content_latest():
        limit = min(20, max(1, int(request.args.get("limit", 8))))
        return jsonify(helpers["get_latest_content_payload"](limit=limit))

    return bp
