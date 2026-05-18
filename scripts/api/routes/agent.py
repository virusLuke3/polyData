from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any, Callable

from flask import Blueprint, jsonify, request

from agent.common.gateway_client import call_market_insight_gateway, call_market_wide_insight_gateway, gateway_configured
from agent.market_insight import build_market_insight, build_market_insight_fallback
from agent.market_wide import build_market_wide_fallback, build_market_wide_insight


AGENT_CACHE_NAMESPACE = "agent:insights"
AGENT_CACHE_VERSION = "v2"
_REFRESH_LOCK = threading.Lock()
_REFRESHING_KEYS: set[str] = set()


def _agent_cache_ttl() -> int:
    try:
        return max(30, int(os.environ.get("POLYDATA_AGENT_CACHE_TTL_SECONDS", "300")))
    except ValueError:
        return 300


def _fallback_cache_ttl() -> int:
    return min(60, _agent_cache_ttl())


def _cache_key(kind: str, payload: dict[str, Any]) -> str:
    digest_payload = {
        "kind": kind,
        "lens": payload.get("lens"),
        "market": _market_identity(payload.get("market")),
        "selectedGroup": _market_identity(payload.get("selectedGroup")),
        "selectedOutcome": payload.get("selectedOutcome"),
        "markets": [_market_identity(item) for item in _list(payload.get("markets"))[:48]],
        "marketGroups": [_market_identity(item) for item in _list(payload.get("marketGroups"))[:36]],
        "trades": [_event_identity(item) for item in _list(payload.get("trades"))[:24]],
        "oracle": [_event_identity(item) for item in _list(payload.get("oracle"))[:24]],
        "content": [_event_identity(item) for item in _list(payload.get("content"))[:12]],
        "alphaSignals": [_event_identity(item) for item in _list(payload.get("alphaSignals"))[:10]],
        "whaleSignals": [_event_identity(item) for item in _list(payload.get("whaleSignals"))[:10]],
        "suspiciousSignals": [_event_identity(item) for item in _list(payload.get("suspiciousSignals"))[:10]],
    }
    raw = json.dumps(digest_payload, sort_keys=True, ensure_ascii=True, default=str)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"{AGENT_CACHE_VERSION}:{kind}:{digest}"


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _market_identity(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        "id": value.get("id") or value.get("groupId") or value.get("eventId") or value.get("slug"),
        "title": value.get("title"),
        "category": value.get("category"),
        "volume24h": value.get("volume24h"),
        "tradeCount24h": value.get("tradeCount24h"),
        "latestPrice": value.get("latestPrice"),
        "outcomeCount": value.get("outcomeCount"),
        "endDate": value.get("endDate"),
    }


def _event_identity(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        "id": value.get("id") or value.get("txHash") or value.get("marketId") or value.get("title"),
        "marketTitle": value.get("marketTitle") or value.get("title"),
        "timestamp": value.get("timestamp") or value.get("eventTime") or value.get("publishedAt"),
        "status": value.get("eventStatus") or value.get("status"),
        "price": value.get("price") or value.get("latestPrice") or value.get("proposedPrice"),
        "size": value.get("size") or value.get("notional"),
    }


def _cached_response(helpers: dict, cache_key: str) -> dict[str, Any] | None:
    reader = helpers.get("get_cached_json")
    cached = reader(AGENT_CACHE_NAMESPACE, cache_key) if callable(reader) else _direct_redis_get(helpers, cache_key)
    if not isinstance(cached, dict):
        return None
    response = dict(cached)
    response["cacheStatus"] = "hit"
    return response


def _store_response(helpers: dict, cache_key: str, response: dict[str, Any], ttl_seconds: int) -> None:
    setter = helpers.get("set_cached_json")
    payload = dict(response)
    payload.pop("cacheStatus", None)
    if callable(setter):
        setter(AGENT_CACHE_NAMESPACE, cache_key, payload, ttl_seconds)
        return
    _direct_redis_set(helpers, cache_key, payload, ttl_seconds)


def _direct_redis_key(cache_key: str) -> str:
    prefix = os.environ.get("POLYDATA_REDIS_PREFIX", "polydata:")
    return f"{prefix}{AGENT_CACHE_NAMESPACE}:{cache_key}"


def _direct_redis_get(helpers: dict, cache_key: str) -> dict[str, Any] | None:
    getter = helpers.get("get_redis_client")
    if not callable(getter):
        return None
    client = getter()
    if client is None:
        return None
    try:
        raw = client.get(_direct_redis_key(cache_key))
        return json.loads(raw) if raw else None
    except Exception:
        _log_exception(helpers, "agent-cache redis-get failed key=%s", cache_key)
        return None


def _direct_redis_set(helpers: dict, cache_key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    getter = helpers.get("get_redis_client")
    if not callable(getter):
        return
    client = getter()
    if client is None:
        return
    try:
        client.setex(_direct_redis_key(cache_key), ttl_seconds, json.dumps(payload, ensure_ascii=True, default=str))
    except Exception:
        _log_exception(helpers, "agent-cache redis-set failed key=%s ttl=%s", cache_key, ttl_seconds)


def _log_exception(helpers: dict, message: str, *args: Any) -> None:
    logger = getattr(helpers.get("app"), "logger", None)
    if logger is not None:
        logger.exception(message, *args)


def _schedule_refresh(helpers: dict, cache_key: str, builder: Callable[[], dict[str, Any]]) -> bool:
    with _REFRESH_LOCK:
        if cache_key in _REFRESHING_KEYS:
            return False
        _REFRESHING_KEYS.add(cache_key)

    def refresh() -> None:
        try:
            response = builder()
            if isinstance(response, dict) and response.get("brief") and isinstance(response.get("focus"), list):
                ttl = _agent_cache_ttl() if response.get("status") == "live" else _fallback_cache_ttl()
                response["cacheRefreshedAt"] = response.get("generatedAt")
                _store_response(helpers, cache_key, response, ttl)
        except Exception:
            _log_exception(helpers, "agent-cache refresh failed key=%s", cache_key)
        finally:
            with _REFRESH_LOCK:
                _REFRESHING_KEYS.discard(cache_key)

    thread = threading.Thread(target=refresh, name=f"agent-cache:{cache_key[:20]}", daemon=True)
    thread.start()
    return True


def _serve_agent_with_cache(
    helpers: dict,
    *,
    kind: str,
    payload: dict[str, Any],
    live_builder: Callable[[], dict[str, Any]],
    fallback_builder: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    cache_key = _cache_key(kind, payload)
    cached = _cached_response(helpers, cache_key)
    if cached is not None:
        if cached.get("status") != "live":
            _schedule_refresh(helpers, cache_key, live_builder)
        return cached

    scheduled = _schedule_refresh(helpers, cache_key, live_builder)
    fallback = fallback_builder()
    fallback["cacheStatus"] = "warming" if scheduled else "warming-in-progress"
    fallback["cacheKey"] = cache_key
    _store_response(helpers, cache_key, fallback, _fallback_cache_ttl())
    return fallback


def create_agent_blueprint(helpers: dict) -> Blueprint:
    bp = Blueprint("agent_routes", __name__)

    @bp.route("/agent/market-insights", methods=["POST"])
    def api_market_insights():
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        if request.headers.get("X-PolyData-Agent-Gateway-Attempt") == "1":
            return jsonify(build_market_insight(payload))
        return jsonify(_serve_agent_with_cache(
            helpers,
            kind="market",
            payload=payload,
            live_builder=lambda: call_market_insight_gateway(payload) if gateway_configured() else build_market_insight(payload),
            fallback_builder=lambda: build_market_insight_fallback(payload),
        ))

    @bp.route("/agent/market-wide-insights", methods=["POST"])
    def api_market_wide_insights():
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object required"}), 400
        if request.headers.get("X-PolyData-Agent-Gateway-Attempt") == "1":
            return jsonify(build_market_wide_insight(payload))
        return jsonify(_serve_agent_with_cache(
            helpers,
            kind="market-wide",
            payload=payload,
            live_builder=lambda: call_market_wide_insight_gateway(payload) if gateway_configured() else build_market_wide_insight(payload),
            fallback_builder=lambda: build_market_wide_fallback(payload),
        ))

    return bp
