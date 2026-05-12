from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "goods-tariff-supply-watch"
ROUTE = "/runtime/macro/goods-tariff-supply-watch"
DEFAULT_LIMIT = 36
MIN_LIMIT = 8
MAX_LIMIT = 60


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_goods_tariff_supply_watch_snapshot"](limit=limit)
