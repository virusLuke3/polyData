from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


DEFI_TOKEN_WATCH_NAMESPACE = "snapshot:finance:defi-token-watch"
DEFAULT_DEFI_TOKEN_LIMIT = 10
DEFAULT_DEFI_TOKEN_IDS = (
    "uniswap",
    "pendle",
    "maker",
    "aave",
    "lido-dao",
    "ethena",
    "curve-dao-token",
    "compound-governance-token",
    "synthetix-network-token",
    "rocket-pool",
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _configured_ids(settings: Any) -> tuple[str, ...]:
    values = getattr(settings, "defi_token_watch_ids", ()) or DEFAULT_DEFI_TOKEN_IDS
    return tuple(str(value).strip() for value in values if str(value).strip()) or DEFAULT_DEFI_TOKEN_IDS


def build_defi_token_watch_cache_key(settings: Any, *, limit: int = DEFAULT_DEFI_TOKEN_LIMIT) -> str:
    return json.dumps(
        {
            "limit": int(limit or DEFAULT_DEFI_TOKEN_LIMIT),
            "ids": list(_configured_ids(settings)),
            "source": getattr(settings, "coingecko_base_url", ""),
            "version": 1,
        },
        sort_keys=True,
        ensure_ascii=True,
    )


def _tone(change: Any) -> str:
    numeric = _safe_float(change)
    if numeric is None:
        return "neutral"
    if numeric > 0:
        return "up"
    if numeric < 0:
        return "down"
    return "neutral"


def _tags(row: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    change24h = abs(_safe_float(row.get("change24h")) or 0.0)
    change7d = abs(_safe_float(row.get("change7d")) or 0.0)
    if change24h >= 5:
        tags.append("HOT")
    elif change24h >= 2:
        tags.append("MOVE")
    if change7d >= 10:
        tags.append("7D")
    if (_safe_float(row.get("volume24h")) or 0.0) > 100_000_000:
        tags.append("FLOW")
    return tags[:3]


def _normalize_item(item: Dict[str, Any]) -> Dict[str, Any]:
    spark = (((item.get("sparkline_in_7d") or {}).get("price")) or [])[-36:]
    row = {
        "id": str(item.get("id") or item.get("symbol") or ""),
        "symbol": str(item.get("symbol") or "").upper(),
        "name": item.get("name"),
        "price": _safe_float(item.get("current_price")),
        "change24h": _safe_float(item.get("price_change_percentage_24h_in_currency") or item.get("price_change_percentage_24h")),
        "change7d": _safe_float(item.get("price_change_percentage_7d_in_currency")),
        "marketCap": _safe_float(item.get("market_cap")),
        "volume24h": _safe_float(item.get("total_volume")),
        "sparkline": [_safe_float(value) for value in spark if _safe_float(value) is not None],
    }
    return {**row, "tone": _tone(row.get("change24h")), "tags": _tags(row)}


def normalize_defi_token_watch_payload(payload: Any, *, settings: Any, limit: int = DEFAULT_DEFI_TOKEN_LIMIT, generated_at: str | None = None) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {
            "generatedAt": generated_at or _utc_now_iso(),
            "status": "invalid",
            "cacheMode": "invalid",
            "sources": {"coingecko": "invalid"},
            "summary": {"count": 0, "topSymbol": None, "moveCount": 0},
            "items": [],
        }
    items = [item for item in (payload.get("items") or []) if isinstance(item, dict)][: max(0, int(limit or DEFAULT_DEFI_TOKEN_LIMIT))]
    status = str(payload.get("status") or ("ok" if items else "empty"))
    move_count = sum(1 for item in items if abs(_safe_float(item.get("change24h")) or 0.0) >= 2)
    top = sorted(items, key=lambda item: abs(_safe_float(item.get("change24h")) or 0.0), reverse=True)[0] if items else None
    return {
        **payload,
        "generatedAt": str(payload.get("generatedAt") or generated_at or _utc_now_iso()),
        "status": status,
        "cacheMode": str(payload.get("cacheMode") or "snapshot"),
        "sources": payload.get("sources") if isinstance(payload.get("sources"), dict) else {"coingecko": "ok" if items else "empty"},
        "summary": {
            **(payload.get("summary") if isinstance(payload.get("summary"), dict) else {}),
            "count": len(items),
            "topSymbol": (top or {}).get("symbol"),
            "moveCount": move_count,
        },
        "items": items,
    }


def fetch_live_defi_token_watch_payload(ctx: dict, limit: int = DEFAULT_DEFI_TOKEN_LIMIT) -> Dict[str, Any]:
    settings = ctx["SETTINGS"]
    ids = _configured_ids(settings)
    payload = ctx["http_json_get"](
        f"{str(settings.coingecko_base_url).rstrip('/')}/coins/markets",
        params={
            "vs_currency": "usd",
            "ids": ",".join(ids),
            "sparkline": "true",
            "price_change_percentage": "24h,7d",
        },
        timeout=12,
        headers={"User-Agent": "polydata-runtime/1.0", "Accept": "application/json"},
    ) or []
    rows = [_normalize_item(item) for item in payload if isinstance(item, dict)]
    configured_order = {token_id: index for index, token_id in enumerate(ids)}
    rows.sort(key=lambda row: configured_order.get(str(row.get("id")), 999))
    return normalize_defi_token_watch_payload(
        {
            "generatedAt": ctx.get("utc_now_iso", _utc_now_iso)(),
            "status": "ok" if rows else "empty",
            "cacheMode": "live-build",
            "sources": {"coingecko": "ok" if rows else "empty"},
            "items": rows,
        },
        settings=settings,
        limit=limit,
    )


def _with_cache_mode(payload: Dict[str, Any], cache_mode: str) -> Dict[str, Any]:
    return {**payload, "cacheMode": str(payload.get("cacheMode") or cache_mode)}


def _read_seeded_snapshot(ctx: dict, *, cache_key: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    reader = ctx.get("get_cached_json")
    if callable(reader):
        redis_payload = reader(DEFI_TOKEN_WATCH_NAMESPACE, cache_key)
        if isinstance(redis_payload, dict):
            ctx["SNAPSHOT_STORE"].set(DEFI_TOKEN_WATCH_NAMESPACE, cache_key, redis_payload, ttl_seconds)
            return _with_cache_mode(redis_payload, "redis-seed")

    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is None:
        return None
    sqlite_payload = snapshot_store.get(DEFI_TOKEN_WATCH_NAMESPACE, cache_key)
    if isinstance(sqlite_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(DEFI_TOKEN_WATCH_NAMESPACE, cache_key, sqlite_payload, ttl_seconds)
        return _with_cache_mode(sqlite_payload, "sqlite-seed")
    stale_payload = snapshot_store.get_stale(DEFI_TOKEN_WATCH_NAMESPACE, cache_key)
    if isinstance(stale_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(DEFI_TOKEN_WATCH_NAMESPACE, cache_key, stale_payload, min(30, ttl_seconds))
        return _with_cache_mode(stale_payload, "stale-seed")
    return None


def _store_seed_fallback(ctx: dict, *, cache_key: str, payload: Dict[str, Any], ttl_seconds: int) -> Dict[str, Any]:
    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is not None:
        snapshot_store.set(DEFI_TOKEN_WATCH_NAMESPACE, cache_key, payload, ttl_seconds)
    setter = ctx.get("set_cached_json")
    if callable(setter):
        setter(DEFI_TOKEN_WATCH_NAMESPACE, cache_key, payload, ttl_seconds)
    return payload


def get_defi_token_watch_snapshot(ctx: dict, limit: int = DEFAULT_DEFI_TOKEN_LIMIT) -> Dict[str, Any]:
    settings = ctx["SETTINGS"]
    limit = max(3, min(24, int(limit or DEFAULT_DEFI_TOKEN_LIMIT)))
    ttl_seconds = max(30, int(getattr(settings, "defi_token_watch_ttl_seconds", 120) or 120))
    cache_key = build_defi_token_watch_cache_key(settings, limit=limit)
    seeded_payload = _read_seeded_snapshot(ctx, cache_key=cache_key, ttl_seconds=ttl_seconds)
    if seeded_payload is None and limit != DEFAULT_DEFI_TOKEN_LIMIT:
        seeded_payload = _read_seeded_snapshot(
            ctx,
            cache_key=build_defi_token_watch_cache_key(settings, limit=DEFAULT_DEFI_TOKEN_LIMIT),
            ttl_seconds=ttl_seconds,
        )
    if seeded_payload is not None:
        return normalize_defi_token_watch_payload(seeded_payload, settings=settings, limit=limit, generated_at=ctx["utc_now_iso"]())

    def _builder() -> Dict[str, Any]:
        return fetch_live_defi_token_watch_payload(ctx, limit=limit)

    if "get_snapshot_payload" in ctx:
        return ctx["get_snapshot_payload"](DEFI_TOKEN_WATCH_NAMESPACE, cache_key, _builder, ttl_seconds=ttl_seconds)
    payload = _builder()
    return _store_seed_fallback(ctx, cache_key=cache_key, payload=payload, ttl_seconds=ttl_seconds)
