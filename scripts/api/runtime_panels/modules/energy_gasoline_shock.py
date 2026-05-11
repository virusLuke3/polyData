from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "energy-gasoline-shock"
ROUTE = "/runtime/macro/energy-gasoline-shock"
DEFAULT_LIMIT = 6
MIN_LIMIT = 3
MAX_LIMIT = 8


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_energy_gasoline_shock_snapshot"](limit=limit)
