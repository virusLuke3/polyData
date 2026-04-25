from __future__ import annotations

import json
from typing import Any, Dict

from f1.runtime_feed import build_f1_panel_payload


def get_f1_panel_snapshot(ctx: dict, limit: int = 10) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit, "version": 3}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        try:
            payload = build_f1_panel_payload(
                requests_lib=ctx.get("requests"),
                limit=limit,
                feed_specs=[
                    {
                        "source": "BWENews",
                        "url": ctx["SETTINGS"].f1_bwenews_rss_url,
                        "source_url": ctx["SETTINGS"].f1_bwenews_source_url,
                    }
                ],
            )
            if isinstance(payload, dict) and "items" not in payload:
                payload["items"] = payload.get("cards") or []
            return payload
        except Exception:
            ctx["app"].logger.exception("f1 runtime snapshot build failed")
            return {
                "generatedAt": ctx["utc_now_iso"](),
                "source": "bwenews-rss",
                "sourceUrl": ctx["SETTINGS"].f1_bwenews_source_url,
                "cards": [],
                "items": [],
                "focusMeeting": None,
                "status": "error",
            }

    return ctx["get_snapshot_payload"](
        "snapshot:sports:f1",
        cache_key,
        _builder,
        ttl_seconds=max(15, int(ctx["SPORTS_RUNTIME_TTL_SECONDS"])),
    )
