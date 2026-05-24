from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "big-tech-market-cap"
ROUTE = "/runtime/tech/big-tech-market-cap"
DEFAULT_LIMIT = 16
MIN_LIMIT = 3
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_tech_panel_snapshot"](PANEL_ID, limit=limit)
