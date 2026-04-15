from __future__ import annotations

from flask import Blueprint, jsonify, request


def create_runtime_sports_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_sports_routes", __name__)

    @bp.route("/runtime/sports/nba", methods=["GET"])
    def api_runtime_nba():
        limit = min(20, max(1, int(request.args.get("limit", 10))))
        return jsonify(helpers["get_nba_scoreboard_snapshot"](limit=limit))

    @bp.route("/runtime/sports/nba-intel", methods=["GET"])
    def api_runtime_nba_intel():
        limit = min(24, max(1, int(request.args.get("limit", 12))))
        return jsonify(helpers["get_nba_intel_snapshot"](limit=limit))

    return bp

