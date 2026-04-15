from __future__ import annotations

from flask import Blueprint, jsonify


def create_runtime_macro_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_macro_routes", __name__)

    @bp.route("/runtime/macro/inflation-nowcast", methods=["GET"])
    def api_runtime_inflation_nowcast():
        return jsonify(helpers["get_inflation_nowcast_snapshot"]())

    return bp

