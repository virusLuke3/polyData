from __future__ import annotations

from typing import Any, Dict


def get_related_content_payload(ctx: dict, market_id: int, limit: int = 8) -> Dict[str, Any]:
    return ctx["get_related_content_by_market_id"](market_id, limit=limit)


def get_latest_content_payload(ctx: dict, limit: int = 8) -> Dict[str, Any]:
    return ctx["get_latest_content_snapshot"](limit=limit)
