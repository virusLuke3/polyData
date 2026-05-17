from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "global-temperature-monitor"
ROUTE = "/runtime/weather/temperature-monitor"
DEFAULT_LIMIT = 34
MIN_LIMIT = 8
MAX_LIMIT = 60


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_global_weather_map_snapshot"](limit=limit)
