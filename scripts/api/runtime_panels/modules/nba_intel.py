from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "nba-intel"
ROUTE = "/runtime/sports/nba-intel"
DEFAULT_LIMIT = 12
MIN_LIMIT = 1
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_nba_intel_snapshot"](limit=limit)
