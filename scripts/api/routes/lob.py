from __future__ import annotations

from flask import Blueprint, jsonify


def create_lob_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("lob_routes", __name__)

    @bp.route("/runtime/lob/<int:market_id>", methods=["GET"])
    def api_runtime_lob_by_market_id(market_id: int):
        payload = helpers["get_runtime_lob_payload"](market_id)
        status_code = int(payload.pop("_status", 200))
        return jsonify(payload), status_code

    return bp
