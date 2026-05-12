from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "food-retail-basket-pressure"
ROUTE = "/runtime/macro/food-retail-basket"
DEFAULT_LIMIT = 8
MIN_LIMIT = 3
MAX_LIMIT = 10


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_food_retail_basket_snapshot"](limit=limit)
