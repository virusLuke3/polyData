from __future__ import annotations

import json
from typing import Any, Dict

from jin10.flash_client import fetch_jin10_panel_payload


JIN10_SNAPSHOT_NAMESPACE = "snapshot:macro:jin10"
JIN10_SELECTION_VERSION = 2


def build_jin10_cache_key(settings: Any, limit: int = 24) -> str:
    return json.dumps(
        {
            "limit": limit,
            "apiUrl": settings.jin10_flash_api_url,
            "channel": settings.jin10_flash_channel,
            "selectionVersion": JIN10_SELECTION_VERSION,
        },
        sort_keys=True,
        ensure_ascii=True,
    )


def normalize_jin10_panel_payload(payload: Any, *, settings: Any, limit: int = 24, generated_at: str | None = None) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {
            "generatedAt": str(generated_at or ""),
            "source": "jin10-flash",
            "sourceUrl": settings.jin10_live_url,
            "status": "invalid",
            "items": [],
        }
    return {
        **payload,
        "generatedAt": str(payload.get("generatedAt") or generated_at or ""),
        "source": str(payload.get("source") or "jin10-flash"),
        "sourceUrl": str(payload.get("sourceUrl") or settings.jin10_live_url),
        "status": str(payload.get("status") or "ok"),
        "items": [item for item in (payload.get("items") or []) if isinstance(item, dict)][:limit],
    }


def fetch_live_jin10_panel_payload(ctx: dict, limit: int = 24) -> Dict[str, Any]:
    payload = fetch_jin10_panel_payload(
        limit=limit,
        api_url=ctx["SETTINGS"].jin10_flash_api_url,
        channel=ctx["SETTINGS"].jin10_flash_channel,
        app_id=ctx["SETTINGS"].jin10_flash_app_id,
        version=ctx["SETTINGS"].jin10_flash_version,
        detail_base_url=ctx["SETTINGS"].jin10_flash_detail_base_url,
        live_url=ctx["SETTINGS"].jin10_live_url,
        requests_lib=ctx.get("requests"),
    )
    return normalize_jin10_panel_payload(
        payload,
        settings=ctx["SETTINGS"],
        limit=limit,
        generated_at=ctx["utc_now_iso"](),
    )


def _with_cache_mode(payload: Dict[str, Any], cache_mode: str) -> Dict[str, Any]:
    return {**payload, "cacheMode": str(payload.get("cacheMode") or cache_mode)}


def _read_seeded_snapshot(ctx: dict, *, cache_key: str, ttl_seconds: int) -> Dict[str, Any] | None:
    redis_payload = ctx["get_cached_json"](JIN10_SNAPSHOT_NAMESPACE, cache_key)
    if isinstance(redis_payload, dict):
        ctx["SNAPSHOT_STORE"].set(JIN10_SNAPSHOT_NAMESPACE, cache_key, redis_payload, ttl_seconds)
        return _with_cache_mode(redis_payload, "redis-seed")

    sqlite_payload = ctx["SNAPSHOT_STORE"].get(JIN10_SNAPSHOT_NAMESPACE, cache_key)
    if isinstance(sqlite_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(JIN10_SNAPSHOT_NAMESPACE, cache_key, sqlite_payload, ttl_seconds)
        return _with_cache_mode(sqlite_payload, "sqlite-seed")

    stale_payload = ctx["SNAPSHOT_STORE"].get_stale(JIN10_SNAPSHOT_NAMESPACE, cache_key)
    if isinstance(stale_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(JIN10_SNAPSHOT_NAMESPACE, cache_key, stale_payload, min(15, ttl_seconds))
        return _with_cache_mode(stale_payload, "stale-seed")
    return None


def get_jin10_panel_snapshot(ctx: dict, limit: int = 24) -> Dict[str, Any]:
    ttl_seconds = max(15, int(ctx["SIGNAL_RUNTIME_TTL_SECONDS"]))
    cache_key = build_jin10_cache_key(ctx["SETTINGS"], limit=limit)
    seeded_payload = _read_seeded_snapshot(ctx, cache_key=cache_key, ttl_seconds=ttl_seconds)
    if seeded_payload is None and int(limit or 0) != 24:
        default_cache_key = build_jin10_cache_key(ctx["SETTINGS"], limit=24)
        seeded_payload = _read_seeded_snapshot(ctx, cache_key=default_cache_key, ttl_seconds=ttl_seconds)
    if seeded_payload is not None:
        return normalize_jin10_panel_payload(
            seeded_payload,
            settings=ctx["SETTINGS"],
            limit=limit,
            generated_at=ctx["utc_now_iso"](),
        )

    payload = fetch_live_jin10_panel_payload(ctx, limit=limit)
    payload = _with_cache_mode(payload, "live-fallback")
    ctx["SNAPSHOT_STORE"].set(JIN10_SNAPSHOT_NAMESPACE, cache_key, payload, ttl_seconds)
    setter = ctx.get("set_cached_json")
    if callable(setter):
        setter(JIN10_SNAPSHOT_NAMESPACE, cache_key, payload, ttl_seconds)
    return payload
