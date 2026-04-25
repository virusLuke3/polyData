from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "f1-trackside"
ROUTE = "/runtime/sports/f1"
DEFAULT_LIMIT = 10
MIN_LIMIT = 1
MAX_LIMIT = 16


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_f1_panel_snapshot"](limit=limit)
