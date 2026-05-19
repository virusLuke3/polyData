from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "onchain-tradfi-perp-radar"
ROUTE = "/runtime/finance/onchain-tradfi-perp-radar"
DEFAULT_LIMIT = 12
MIN_LIMIT = 4
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_onchain_tradfi_perp_radar_snapshot"](limit=limit)
