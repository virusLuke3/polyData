from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "inflation-nowcast"
ROUTE = "/runtime/macro/inflation-nowcast"
DEFAULT_LIMIT = None
MIN_LIMIT = None
MAX_LIMIT = None


def get_snapshot(ctx: Dict[str, Any]) -> Dict[str, Any]:
    return ctx["get_inflation_nowcast_snapshot"]()
