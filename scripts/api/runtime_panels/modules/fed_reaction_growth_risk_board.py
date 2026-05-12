from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "fed-reaction-growth-risk-board"
ROUTE = "/runtime/macro/fed-reaction-growth-risk-board"
DEFAULT_LIMIT = 36
MIN_LIMIT = 8
MAX_LIMIT = 60


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_fed_reaction_growth_risk_board_snapshot"](limit=limit)
