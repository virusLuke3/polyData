from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "crypto-fear-greed"
ROUTE = "/runtime/finance/crypto-fear-greed"
DEFAULT_LIMIT = 6
MIN_LIMIT = 3
MAX_LIMIT = 12


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_finance_watch_panel_snapshot"](PANEL_ID, limit=limit)
