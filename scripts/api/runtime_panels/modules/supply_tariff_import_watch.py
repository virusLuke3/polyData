from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "supply-tariff-import-watch"
ROUTE = "/runtime/macro/supply-tariff-import-watch"
DEFAULT_LIMIT = 8
MIN_LIMIT = 3
MAX_LIMIT = 12


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_supply_tariff_import_watch_snapshot"](limit=limit)
