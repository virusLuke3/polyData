from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "growth-demand-recession-tracker"
ROUTE = "/runtime/macro/growth-demand-recession-tracker"
DEFAULT_LIMIT = 8
MIN_LIMIT = 3
MAX_LIMIT = 12


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_growth_demand_recession_tracker_snapshot"](limit=limit)
