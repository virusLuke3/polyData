from __future__ import annotations

from flask import Blueprint, jsonify


def create_runtime_markets_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_market_routes", __name__)

    @bp.route("/runtime/markets/commodities", methods=["GET"])
    def api_runtime_commodities():
        return jsonify(helpers["get_market_group_snapshot"](helpers["COMMODITY_SYMBOLS"], kind="commodities"))

    @bp.route("/runtime/markets/crypto", methods=["GET"])
    def api_runtime_crypto():
        return jsonify(helpers["get_market_group_snapshot"](helpers["CRYPTO_SYMBOLS"], kind="crypto"))

    return bp

