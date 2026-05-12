from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "cpi-release-command-center"
ROUTE = "/runtime/macro/cpi-release-command-center"
DEFAULT_LIMIT = 36
MIN_LIMIT = 8
MAX_LIMIT = 60


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_cpi_release_command_center_snapshot"](limit=limit)
