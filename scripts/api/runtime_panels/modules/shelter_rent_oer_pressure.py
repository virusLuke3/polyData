from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "shelter-rent-oer-pressure"
ROUTE = "/runtime/macro/shelter-rent-oer-pressure"
DEFAULT_LIMIT = 8
MIN_LIMIT = 3
MAX_LIMIT = 12


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_shelter_rent_oer_pressure_snapshot"](limit=limit)
