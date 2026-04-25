from __future__ import annotations

import json
from typing import Any, Dict, List


NAMESPACE = "runtime:new-market-signals"


def _redis_key(ctx: dict, suffix: str) -> str:
    return f"{ctx['REDIS_PREFIX']}{NAMESPACE}:{suffix}"


def _coerce_items(raw: Any) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(str(raw))
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def get_new_market_signals_snapshot(ctx: dict, limit: int = 12) -> Dict[str, Any]:
    limit = min(50, max(1, int(limit)))
    client = ctx["get_redis_client"]()
    if client is None:
        return {"items": [], "generatedAt": ctx["utc_now_iso"](), "status": "degraded"}
    try:
        raw = client.get(_redis_key(ctx, "items"))
    except Exception:
        ctx["app"].logger.exception("new-market-signals redis read failed")
        return {"items": [], "generatedAt": ctx["utc_now_iso"](), "status": "degraded"}
    return {"items": _coerce_items(raw)[:limit], "generatedAt": ctx["utc_now_iso"]()}
