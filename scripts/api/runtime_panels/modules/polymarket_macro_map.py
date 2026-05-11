from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "polymarket-macro-map"
ROUTE = "/runtime/macro/polymarket-map"
DEFAULT_LIMIT = 12
MIN_LIMIT = 4
MAX_LIMIT = 20


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_polymarket_macro_map_snapshot"](limit=limit)
