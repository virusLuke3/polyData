from __future__ import annotations

from flask import Blueprint, jsonify, request

from api.runtime_panels import RUNTIME_PANEL_MODULES


def create_runtime_panels_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_panel_routes", __name__)

    for panel in RUNTIME_PANEL_MODULES:
        endpoint = f"api_runtime_panel_{panel.panel_id.replace('-', '_')}"

        def _handler(panel=panel):
            limit = panel.clamp_limit(request.args.get("limit"))
            if limit is None:
                return jsonify(panel.get_snapshot(helpers))
            return jsonify(panel.get_snapshot(helpers, limit=limit))

        bp.add_url_rule(panel.route, endpoint, _handler, methods=["GET"])

    return bp
