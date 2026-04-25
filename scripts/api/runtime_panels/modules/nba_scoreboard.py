from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "nba-scoreboard"
ROUTE = "/runtime/sports/nba"
DEFAULT_LIMIT = 10
MIN_LIMIT = 1
MAX_LIMIT = 20


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_nba_scoreboard_snapshot"](limit=limit)
