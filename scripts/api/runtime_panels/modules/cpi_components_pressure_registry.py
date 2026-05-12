from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "cpi-components-pressure-registry"
ROUTE = "/runtime/macro/cpi-components-pressure-registry"
DEFAULT_LIMIT = 48
MIN_LIMIT = 12
MAX_LIMIT = 60


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_cpi_components_pressure_registry_snapshot"](limit=limit)
