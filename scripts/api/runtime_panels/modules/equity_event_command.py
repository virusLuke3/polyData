from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "equity-event-command"
ROUTE = "/runtime/finance/equity-event-command"
DEFAULT_LIMIT = 12
MIN_LIMIT = 4
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_equity_event_command_snapshot"](limit=limit)
