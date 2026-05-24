from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "ai-model-race"
ROUTE = "/runtime/tech/ai-model-race"
DEFAULT_LIMIT = 36
MIN_LIMIT = 3
MAX_LIMIT = 36


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_tech_panel_snapshot"](PANEL_ID, limit=limit)
