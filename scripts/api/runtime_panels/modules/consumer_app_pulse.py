from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "consumer-app-pulse"
ROUTE = "/runtime/tech/consumer-app-pulse"
DEFAULT_LIMIT = 40
MIN_LIMIT = 3
MAX_LIMIT = 40


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_tech_panel_snapshot"](PANEL_ID, limit=limit)
