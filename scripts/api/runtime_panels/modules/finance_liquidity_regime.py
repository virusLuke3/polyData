from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "finance-liquidity-regime"
ROUTE = "/runtime/finance/liquidity-regime"
DEFAULT_LIMIT = 12
MIN_LIMIT = 4
MAX_LIMIT = 24


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_finance_liquidity_regime_snapshot"](limit=limit)
