from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "jin10-flash"
ROUTE = "/runtime/macro/jin10"
DEFAULT_LIMIT = 24
MIN_LIMIT = 4
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_jin10_panel_snapshot"](limit=limit)
