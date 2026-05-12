from __future__ import annotations

from typing import Any, Dict


PANEL_ID = "sports-odds"
ROUTE = "/runtime/sports/odds-monitor"
DEFAULT_LIMIT = 8
MIN_LIMIT = 2
MAX_LIMIT = 20


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_sports_odds_snapshot"](limit=limit)
