from __future__ import annotations

from flask import Blueprint, jsonify, request


def create_runtime_jin10_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_jin10_routes", __name__)

    @bp.route("/runtime/macro/jin10", methods=["GET"])
    def api_runtime_jin10():
        limit = min(24, max(4, int(request.args.get("limit", 24))))
        return jsonify(helpers["get_jin10_panel_snapshot"](limit=limit))

    return bp
