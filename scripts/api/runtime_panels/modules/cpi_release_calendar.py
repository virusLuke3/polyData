from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "cpi-release-calendar"
ROUTE = "/runtime/macro/cpi-release-calendar"
DEFAULT_LIMIT = 8
MIN_LIMIT = 3
MAX_LIMIT = 12


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_cpi_release_calendar_snapshot"](limit=limit)
