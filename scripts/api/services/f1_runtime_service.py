from __future__ import annotations

import json
from typing import Any, Dict

from f1.runtime_feed import build_f1_panel_payload


def get_f1_panel_snapshot(ctx: dict, limit: int = 10) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit, "version": 3}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        try:
            return build_f1_panel_payload(
                requests_lib=ctx.get("requests"),
                limit=limit,
            )
        except Exception:
            ctx["app"].logger.exception("f1 runtime snapshot build failed")
            return {
                "generatedAt": ctx["utc_now_iso"](),
                "source": "bwenews-rss",
                "sourceUrl": "https://x.com/bwenews",
                "cards": [],
                "focusMeeting": None,
                "status": "error",
            }

    return ctx["get_snapshot_payload"](
        "snapshot:sports:f1",
        cache_key,
        _builder,
        ttl_seconds=max(15, int(ctx["SPORTS_RUNTIME_TTL_SECONDS"])),
    )
