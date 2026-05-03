from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Any, Dict


SEED_META_SPECS = [
    {
        "panelId": "geo-sanctions-shock",
        "namespace": "seed-meta:world",
        "cacheKey": "geo-sanctions-shock",
        "serviceName": "polydata-geo-sanctions-shock.service",
        "intervalEnv": "POLYDATA_GEO_SHOCK_WATCH_INTERVAL_SECONDS",
        "defaultIntervalSeconds": 300,
    },
    {
        "panelId": "new-market-signals",
        "namespace": "seed-meta:markets",
        "cacheKey": "new-market-signals",
        "serviceName": "polydata-new-market-signal.service",
        "intervalEnv": "POLYDATA_NEW_MARKET_SIGNAL_INTERVAL_SECONDS",
        "defaultIntervalSeconds": 20,
    },
]


def _read_seed_meta(ctx: dict, *, namespace: str, cache_key: str) -> Dict[str, Any] | None:
    reader = ctx.get("get_cached_json")
    if callable(reader):
        payload = reader(namespace, cache_key)
        if isinstance(payload, dict):
            return payload
    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is not None:
        payload = snapshot_store.get_stale(namespace, cache_key)
        if isinstance(payload, dict):
            return payload
    return None


def _age_seconds_from_iso(raw: Any) -> int | None:
    if not raw:
        return None
    try:
        iso = str(raw).replace("Z", "+00:00")
        return max(0, int(time.time() - datetime.fromisoformat(iso).timestamp()))
    except Exception:
        return None


def _freshness_label(age_seconds: int | None, expected_interval_seconds: int) -> str:
    if age_seconds is None:
        return "unknown"
    if age_seconds <= max(30, expected_interval_seconds * 2):
        return "fresh"
    if age_seconds <= max(60, expected_interval_seconds * 6):
        return "aging"
    return "stale"


def build_system_health_payload(ctx: dict) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "database": ctx["describe_db_target"](),
        "redis": bool(ctx["get_redis_client"]()),
        "apiStatus": "ok",
        "lobRuntime": {"status": "ready", "mode": "memory"},
        "contentSync": {"status": "runtime-rss" if not ctx["table_exists"]("content_items") else "database"},
    }
    if not ctx["table_exists"]("sync_state"):
        payload["syncState"] = {}
        return payload

    sync_rows = ctx["query_all"](
        """
        SELECT `key`, value, last_block, updated_at
        FROM sync_state
        WHERE `key` IN (?, ?, ?, ?, ?, ?)
        ORDER BY updated_at DESC
        """,
        (
            "market_sync",
            "trade_sync",
            "oracle_sync",
            "market_sync_live",
            "trade_sync_live",
            "oracle_sync_live",
        ),
    )
    sync_state = {}
    for row in sync_rows:
        sync_state[row.get("key")] = {
            "value": row.get("value"),
            "lastBlock": row.get("last_block"),
            "updatedAt": row.get("updated_at"),
        }
    payload["syncState"] = sync_state
    payload["marketSync"] = sync_state.get("market_sync_live") or sync_state.get("market_sync")
    payload["tradeSync"] = sync_state.get("trade_sync_live") or sync_state.get("trade_sync")
    payload["oracleSync"] = sync_state.get("oracle_sync_live") or sync_state.get("oracle_sync")
    payload["priceSync"] = {
        "status": "derived-from-trades",
        "updatedAt": ctx["query_one"]("SELECT MAX(latest_trade_at) AS updated_at FROM market_latest_prices").get("updated_at")
        if ctx["table_exists"]("market_latest_prices")
        else None,
    }
    return payload


def build_seed_health_payload(ctx: dict) -> Dict[str, Any]:
    items = []
    for spec in SEED_META_SPECS:
        payload = _read_seed_meta(ctx, namespace=spec["namespace"], cache_key=spec["cacheKey"]) or {}
        expected_interval_seconds = max(
            1,
            int(os.environ.get(spec["intervalEnv"], payload.get("expectedIntervalSeconds") or spec["defaultIntervalSeconds"])),
        )
        last_attempt_at = payload.get("lastAttemptAt")
        last_success_at = payload.get("lastSuccessAt")
        attempt_age_seconds = _age_seconds_from_iso(last_attempt_at)
        success_age_seconds = _age_seconds_from_iso(last_success_at)
        freshness = _freshness_label(success_age_seconds, expected_interval_seconds)
        status = str(payload.get("status") or ("missing" if not payload else "unknown")).strip().lower()
        if status == "ok" and freshness != "fresh":
            status = "degraded"
        if status == "scan":
            status = "ok"
        if status == "bootstrap":
            status = "ok"
        if status == "preserved":
            status = "degraded"
        item = {
            "panelId": spec["panelId"],
            "serviceName": spec["serviceName"],
            "status": status,
            "freshness": freshness,
            "expectedIntervalSeconds": expected_interval_seconds,
            "lastAttemptAt": last_attempt_at,
            "lastSuccessAt": last_success_at,
            "attemptAgeSeconds": attempt_age_seconds,
            "successAgeSeconds": success_age_seconds,
            "recordCount": int(payload.get("recordCount") or 0),
            "sourceStates": payload.get("sourceStates") if isinstance(payload.get("sourceStates"), dict) else {},
            "errorSummary": payload.get("errorSummary"),
            "cacheMode": payload.get("cacheMode"),
            "payloadStatus": payload.get("payloadStatus"),
            "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
        }
        items.append(item)

    ok_count = sum(1 for item in items if item["status"] == "ok")
    degraded_count = sum(1 for item in items if item["status"] == "degraded")
    error_count = sum(1 for item in items if item["status"] in {"error", "missing"})
    overall_status = "ok"
    if error_count:
        overall_status = "error"
    elif degraded_count:
        overall_status = "degraded"
    return {
        "generatedAt": ctx["utc_now_iso"](),
        "status": overall_status,
        "summary": {
            "watcherCount": len(items),
            "okCount": ok_count,
            "degradedCount": degraded_count,
            "errorCount": error_count,
        },
        "items": items,
    }
