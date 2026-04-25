from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "commodities-watch"
ROUTE = "/runtime/markets/commodities"
DEFAULT_LIMIT = None
MIN_LIMIT = None
MAX_LIMIT = None


def get_snapshot(ctx: Dict[str, Any]) -> Dict[str, Any]:
    return ctx["get_market_group_snapshot"](ctx["COMMODITY_SYMBOLS"], kind="commodities")
