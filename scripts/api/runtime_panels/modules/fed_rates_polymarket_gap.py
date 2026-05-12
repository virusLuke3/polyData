from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "fed-rates-polymarket-gap"
ROUTE = "/runtime/macro/fed-rates-polymarket-gap"
DEFAULT_LIMIT = 8
MIN_LIMIT = 3
MAX_LIMIT = 12


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_fed_rates_polymarket_gap_snapshot"](limit=limit)
