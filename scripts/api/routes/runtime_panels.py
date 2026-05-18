from __future__ import annotations

from flask import Blueprint, jsonify, request

from api.runtime_panels import RUNTIME_PANEL_MODULES


def _publish_runtime_panel(panel_id: str, payload: dict) -> None:
    try:
        from telegram.topics.runtime_bridge import publish_panel_snapshot
    except Exception:
        return
    try:
        publish_panel_snapshot(panel_id, payload)
    except Exception:
        return


def create_runtime_panels_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("runtime_panel_routes", __name__)

    for panel in RUNTIME_PANEL_MODULES:
        endpoint = f"api_runtime_panel_{panel.panel_id.replace('-', '_')}"

        def _handler(panel=panel):
            limit = panel.clamp_limit(request.args.get("limit"))
            if limit is None:
                payload = panel.get_snapshot(helpers)
            else:
                payload = panel.get_snapshot(helpers, limit=limit)
            _publish_runtime_panel(panel.panel_id, payload)
            return jsonify(payload)

        bp.add_url_rule(panel.route, endpoint, _handler, methods=["GET"])

    return bp
