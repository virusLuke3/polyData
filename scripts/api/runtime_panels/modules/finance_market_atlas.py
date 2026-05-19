from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "finance-market-atlas"
ROUTE = "/runtime/finance/market-atlas"
DEFAULT_LIMIT = 16
MIN_LIMIT = 4
MAX_LIMIT = 40


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_finance_market_atlas_snapshot"](limit=limit)
