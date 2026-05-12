from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "labor-services-inflation-monitor"
ROUTE = "/runtime/macro/labor-services-inflation-monitor"
DEFAULT_LIMIT = 36
MIN_LIMIT = 8
MAX_LIMIT = 60


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_labor_services_inflation_monitor_snapshot"](limit=limit)
