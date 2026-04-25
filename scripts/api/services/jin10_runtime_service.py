from __future__ import annotations

import json
from typing import Any, Dict

from jin10.flash_client import fetch_jin10_panel_payload


def get_jin10_panel_snapshot(ctx: dict, limit: int = 24) -> Dict[str, Any]:
    cache_key = json.dumps(
        {
            "limit": limit,
            "apiUrl": ctx["SETTINGS"].jin10_flash_api_url,
            "channel": ctx["SETTINGS"].jin10_flash_channel,
            "selectionVersion": 2,
        },
        sort_keys=True,
        ensure_ascii=True,
    )

    def _builder() -> Dict[str, Any]:
        payload = fetch_jin10_panel_payload(
            limit=limit,
            api_url=ctx["SETTINGS"].jin10_flash_api_url,
            channel=ctx["SETTINGS"].jin10_flash_channel,
            app_id=ctx["SETTINGS"].jin10_flash_app_id,
            version=ctx["SETTINGS"].jin10_flash_version,
            detail_base_url=ctx["SETTINGS"].jin10_flash_detail_base_url,
            live_url=ctx["SETTINGS"].jin10_live_url,
        )
        if not isinstance(payload, dict):
            return {
                "generatedAt": ctx["utc_now_iso"](),
                "source": "jin10-flash",
                "sourceUrl": ctx["SETTINGS"].jin10_live_url,
                "status": "invalid",
                "items": [],
            }
        return {
            **payload,
            "generatedAt": str(payload.get("generatedAt") or ctx["utc_now_iso"]()),
            "source": str(payload.get("source") or "jin10-flash"),
            "sourceUrl": str(payload.get("sourceUrl") or ctx["SETTINGS"].jin10_live_url),
            "status": str(payload.get("status") or "ok"),
            "items": [item for item in (payload.get("items") or []) if isinstance(item, dict)][:limit],
        }

    return ctx["get_snapshot_payload"](
        "snapshot:macro:jin10",
        cache_key,
        _builder,
        ttl_seconds=max(15, int(ctx["SIGNAL_RUNTIME_TTL_SECONDS"])),
    )
