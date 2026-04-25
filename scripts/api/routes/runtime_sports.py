from __future__ import annotations

from flask import Blueprint, jsonify, request


def _bounded_int_arg(name: str, default: int, *, lower: int, upper: int) -> int:
    try:
        value = int(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    return min(upper, max(lower, value))


def create_runtime_sports_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_sports_routes", __name__)

    @bp.route("/runtime/sports/nba", methods=["GET"])
    def api_runtime_nba():
        limit = _bounded_int_arg("limit", 10, lower=1, upper=20)
        return jsonify(helpers["get_nba_scoreboard_snapshot"](limit=limit))

    @bp.route("/runtime/sports/nba-intel", methods=["GET"])
    def api_runtime_nba_intel():
        limit = _bounded_int_arg("limit", 12, lower=1, upper=24)
        return jsonify(helpers["get_nba_intel_snapshot"](limit=limit))

    @bp.route("/runtime/sports/nba-matchup-predictor", methods=["GET"])
    def api_runtime_nba_matchup_predictor():
        limit = _bounded_int_arg("limit", 8, lower=1, upper=16)
        return jsonify(helpers["get_nba_matchup_predictor_snapshot"](limit=limit))

    return bp
