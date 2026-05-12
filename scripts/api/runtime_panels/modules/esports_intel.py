from __future__ import annotations

from typing import Any, Dict


PANEL_ID = "esports-intel"
ROUTE = "/runtime/esports/grid-intel"
DEFAULT_LIMIT = 10
MIN_LIMIT = 2
MAX_LIMIT = 20


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_grid_esports_snapshot"](limit=limit)
