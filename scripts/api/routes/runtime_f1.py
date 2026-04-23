from __future__ import annotations

from flask import Blueprint, jsonify, request


def create_runtime_f1_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_f1_routes", __name__)

    @bp.route("/runtime/sports/f1", methods=["GET"])
    def api_runtime_f1():
        limit = min(16, max(1, int(request.args.get("limit", 10))))
        return jsonify(helpers["get_f1_panel_snapshot"](limit=limit))

    return bp
