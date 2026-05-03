from __future__ import annotations

import json
from typing import Any, Dict

from f1.runtime_feed import build_f1_panel_payload


F1_SNAPSHOT_NAMESPACE = "snapshot:sports:f1"
F1_SELECTION_VERSION = 3


def build_f1_cache_key(limit: int = 10) -> str:
    return json.dumps({"limit": limit, "version": F1_SELECTION_VERSION}, sort_keys=True, ensure_ascii=True)


def normalize_f1_panel_payload(payload: Any, *, settings: Any, limit: int = 10, generated_at: str | None = None) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {
            "generatedAt": str(generated_at or ""),
            "source": "bwenews-rss",
            "sourceUrl": settings.f1_bwenews_source_url,
            "cards": [],
            "items": [],
            "focusMeeting": None,
            "status": "invalid",
        }
    cards = [item for item in (payload.get("cards") or payload.get("items") or []) if isinstance(item, dict)][:limit]
    return {
        **payload,
        "generatedAt": str(payload.get("generatedAt") or generated_at or ""),
        "source": str(payload.get("source") or "bwenews-rss"),
        "sourceUrl": str(payload.get("sourceUrl") or settings.f1_bwenews_source_url),
        "status": str(payload.get("status") or ("ok" if cards else "empty")),
        "focusMeeting": payload.get("focusMeeting"),
        "cards": cards,
        "items": cards,
    }


def fetch_live_f1_panel_payload(ctx: dict, limit: int = 10) -> Dict[str, Any]:
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
        return normalize_f1_panel_payload(
            payload,
            settings=ctx["SETTINGS"],
            limit=limit,
            generated_at=ctx["utc_now_iso"](),
        )
    except Exception:
        ctx["app"].logger.exception("f1 runtime snapshot build failed")
        return normalize_f1_panel_payload(
            {"status": "error"},
            settings=ctx["SETTINGS"],
            limit=limit,
            generated_at=ctx["utc_now_iso"](),
        )


def _with_cache_mode(payload: Dict[str, Any], cache_mode: str) -> Dict[str, Any]:
    return {**payload, "cacheMode": str(payload.get("cacheMode") or cache_mode)}


def _read_seeded_snapshot(ctx: dict, *, cache_key: str, ttl_seconds: int) -> Dict[str, Any] | None:
    redis_payload = ctx["get_cached_json"](F1_SNAPSHOT_NAMESPACE, cache_key)
    if isinstance(redis_payload, dict):
        ctx["SNAPSHOT_STORE"].set(F1_SNAPSHOT_NAMESPACE, cache_key, redis_payload, ttl_seconds)
        return _with_cache_mode(redis_payload, "redis-seed")

    sqlite_payload = ctx["SNAPSHOT_STORE"].get(F1_SNAPSHOT_NAMESPACE, cache_key)
    if isinstance(sqlite_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(F1_SNAPSHOT_NAMESPACE, cache_key, sqlite_payload, ttl_seconds)
        return _with_cache_mode(sqlite_payload, "sqlite-seed")

    stale_payload = ctx["SNAPSHOT_STORE"].get_stale(F1_SNAPSHOT_NAMESPACE, cache_key)
    if isinstance(stale_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(F1_SNAPSHOT_NAMESPACE, cache_key, stale_payload, min(15, ttl_seconds))
        return _with_cache_mode(stale_payload, "stale-seed")
    return None


def get_f1_panel_snapshot(ctx: dict, limit: int = 10) -> Dict[str, Any]:
    ttl_seconds = max(15, int(ctx["SPORTS_RUNTIME_TTL_SECONDS"]))
    cache_key = build_f1_cache_key(limit=limit)
    seeded_payload = _read_seeded_snapshot(ctx, cache_key=cache_key, ttl_seconds=ttl_seconds)
    if seeded_payload is None and int(limit or 0) != 10:
        seeded_payload = _read_seeded_snapshot(ctx, cache_key=build_f1_cache_key(limit=10), ttl_seconds=ttl_seconds)
    if seeded_payload is not None:
        return normalize_f1_panel_payload(
            seeded_payload,
            settings=ctx["SETTINGS"],
            limit=limit,
            generated_at=ctx["utc_now_iso"](),
        )

    payload = _with_cache_mode(fetch_live_f1_panel_payload(ctx, limit=limit), "live-fallback")
    ctx["SNAPSHOT_STORE"].set(F1_SNAPSHOT_NAMESPACE, cache_key, payload, ttl_seconds)
    setter = ctx.get("set_cached_json")
    if callable(setter):
        setter(F1_SNAPSHOT_NAMESPACE, cache_key, payload, ttl_seconds)
    return payload
