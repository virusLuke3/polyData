from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "espn-matchup-predictor"
ROUTE = "/runtime/sports/nba-matchup-predictor"
DEFAULT_LIMIT = 8
MIN_LIMIT = 1
MAX_LIMIT = 16


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_nba_matchup_predictor_snapshot"](limit=limit)
