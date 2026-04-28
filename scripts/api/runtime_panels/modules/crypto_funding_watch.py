from __future__ import annotations

from typing import Any, Dict

PANEL_ID = "crypto-funding-watch"
ROUTE = "/runtime/crypto/funding-watch"
DEFAULT_LIMIT = 16
MIN_LIMIT = 4
MAX_LIMIT = 30


def get_snapshot(ctx: Dict[str, Any], *, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    return ctx["get_crypto_funding_watch_snapshot"](limit=limit)
