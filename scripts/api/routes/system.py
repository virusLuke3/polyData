from __future__ import annotations

from flask import Blueprint, jsonify


def create_system_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("system_routes", __name__)

    @bp.route("/system/health", methods=["GET"])
    def api_system_health():
        return jsonify(helpers["build_system_health_payload"]())

    @bp.route("/system/seed-health", methods=["GET"])
    @bp.route("/runtime/system/seed-health", methods=["GET"])
    def api_seed_health():
        return jsonify(helpers["build_seed_health_payload"]())

    @bp.route("/health", methods=["GET"])
    def health():
        return jsonify(
            {
                "status": "ok",
                "database": helpers["describe_db_target"](),
                "redis": bool(helpers["get_redis_client"]()),
            }
        )

    return bp
