from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "defi-token-watch"
ROUTE = "/runtime/finance/defi-token-watch"
DEFAULT_LIMIT = 10
MIN_LIMIT = 3
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_defi_token_watch_snapshot"](limit=limit)
