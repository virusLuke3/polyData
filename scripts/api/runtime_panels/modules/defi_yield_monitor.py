from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "defi-yield-monitor"
ROUTE = "/runtime/finance/defi-yield-monitor"
DEFAULT_LIMIT = 10
MIN_LIMIT = 3
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_finance_watch_panel_snapshot"](PANEL_ID, limit=limit)
