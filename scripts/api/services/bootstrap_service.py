from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


BOOTSTRAP_SNAPSHOT_NAMESPACE = "snapshot:bootstrap"
BOOTSTRAP_CACHE_KEY = "workspace-default-v1"
SNAPSHOT_PREWARM_INTERVAL_SECONDS = 15


def build_dashboard_payload(ctx: dict) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace("+00:00", "Z")
    last_24h = (now - timedelta(hours=24)).isoformat().replace("+00:00", "Z")
    status_rows = ctx["fetch_dashboard_market_status"](now_iso)
    active_markets = sum(int(row.get("value") or 0) for row in status_rows if row.get("name") in {"Active", "Proposed"})
    settlements_row = ctx["query_one"](
        """
        SELECT COUNT(*) AS settlements_24h
        FROM oracle_events
        WHERE event_status = 'settle' AND event_time >= ?
        """,
        (last_24h,),
    )
    trade_volume_rows = ctx["fetch_dashboard_trade_volume"](ctx["RECENT_TRADE_WINDOW"])
    recent_rows = ctx["fetch_dashboard_recent_markets"](now_iso, ctx["RECENT_TRADE_WINDOW"])
    trade_window = ctx["fetch_recent_trade_window_bounds"](ctx["RECENT_TRADE_WINDOW"])
    trade_count_estimate = ctx["fetch_trade_count_estimate"]()
    latest_trade_ts = trade_window.get("latest_timestamp")
    earliest_trade_ts = trade_window.get("earliest_timestamp")
    coverage_7d_start = ctx["iso_days_before"](latest_trade_ts, 7)
    coverage_30d_start = ctx["iso_days_before"](latest_trade_ts, 30)
    return {
        "metrics": {
            "activeMarkets": active_markets,
            "totalTrades": int(trade_count_estimate.get("table_rows") or 0),
            "settlements24h": int(settlements_row.get("settlements_24h") or 0),
        },
        "volume7d": [{"day": str(row.get("day")) if row.get("day") is not None else None, "trade_count": int(row.get("trade_count") or 0)} for row in trade_volume_rows[-7:]],
        "volume30d": [{"day": str(row.get("day")) if row.get("day") is not None else None, "trade_count": int(row.get("trade_count") or 0)} for row in trade_volume_rows[-30:]],
        "statusShare": status_rows,
        "recentActiveMarkets": [
            {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "tradeCount": int(row.get("trade_count") or 0),
                "lastTradeAt": row.get("last_trade_at"),
                "status": row.get("status"),
                "endDate": row.get("end_date"),
                "latestPrice": row.get("latest_price"),
            }
            for row in recent_rows
        ],
        "metadata": {
            "generatedAt": now_iso,
            "cacheTtlSeconds": ctx["DASHBOARD_CACHE_TTL_SECONDS"],
            "tradeWindowSize": ctx["RECENT_TRADE_WINDOW"],
            "tradeWindowEarliestTimestamp": earliest_trade_ts,
            "tradeWindowLatestTimestamp": latest_trade_ts,
            "tradeWindowSource": trade_window.get("source"),
            "tradeWindowCovers7d": bool(coverage_7d_start and earliest_trade_ts and earliest_trade_ts <= coverage_7d_start),
            "tradeWindowCovers30d": bool(coverage_30d_start and earliest_trade_ts and earliest_trade_ts <= coverage_30d_start),
            "totalTradesSource": "information_schema.table_rows",
            "totalTradesAutoIncrement": int(trade_count_estimate.get("auto_increment") or 0),
        },
    }


def get_dashboard_payload_cached(ctx: dict) -> Dict[str, Any]:
    redis_cache_key = "dashboard"
    redis_payload = ctx["get_cached_json"]("dashboard", redis_cache_key)
    if redis_payload is not None:
        ctx["app"].logger.info("dashboard-cache redis-hit")
        return redis_payload
    now_monotonic = time.monotonic()
    cached = ctx["_dashboard_cache"].get("value")
    if cached is not None and ctx["_dashboard_cache"].get("expires_at", 0.0) > now_monotonic:
        ctx["app"].logger.info("dashboard-cache hit ttl_remaining_ms=%.2f", (ctx["_dashboard_cache"].get("expires_at", 0.0) - now_monotonic) * 1000)
        return cached
    with ctx["_dashboard_cache_lock"]:
        cached = ctx["_dashboard_cache"].get("value")
        if cached is not None and ctx["_dashboard_cache"].get("expires_at", 0.0) > time.monotonic():
            ctx["app"].logger.info("dashboard-cache hit-after-lock")
            return cached
        ctx["app"].logger.info("dashboard-cache rebuild window_size=%s ttl_seconds=%s", ctx["RECENT_TRADE_WINDOW"], ctx["DASHBOARD_CACHE_TTL_SECONDS"])
        payload = build_dashboard_payload(ctx)
        ctx["_dashboard_cache"]["value"] = payload
        ctx["_dashboard_cache"]["expires_at"] = time.monotonic() + ctx["DASHBOARD_CACHE_TTL_SECONDS"]
        ctx["set_cached_json"]("dashboard", redis_cache_key, payload, ctx["DASHBOARD_CACHE_TTL_SECONDS"])
        return payload


def _status_priority(status: Any) -> int:
    normalized = str(status or "").strip().lower()
    if normalized == "active":
        return 2
    if normalized == "proposed":
        return 1
    return 0


def _safe_float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _normalize_bootstrap_market_item(ctx: dict, row: Dict[str, Any]) -> Dict[str, Any]:
    yes_token_id = str(row.get("yes_token_id") or "").strip()
    no_token_id = str(row.get("no_token_id") or "").strip()
    return {
        "id": row.get("id"),
        "slug": row.get("slug"),
        "title": row.get("title"),
        "conditionId": row.get("condition_id"),
        "questionId": row.get("question_id"),
        "endDate": row.get("end_date"),
        "createdAt": row.get("created_at"),
        "latestPrice": row.get("latest_price"),
        "status": row.get("status"),
        "category": row.get("category") or "Uncategorized",
        "tags": ctx["parse_json_list"](row.get("tags")),
        "outcomeCount": int(bool(yes_token_id)) + int(bool(no_token_id)),
        "volume24h": row.get("volume_24h"),
        "tradeCount24h": _safe_int(row.get("trade_count_24h")),
        "change24h": row.get("change_24h"),
        "lastTradeAt": row.get("last_trade_at") or row.get("latest_trade_at"),
    }


def _build_bootstrap_active_markets_payload(ctx: dict, page_size: int = 20) -> Dict[str, Any]:
    now_iso = ctx["utc_now_iso"]()
    raw_limit = max(page_size * 6, 120)
    candidate_rows = ctx["query_all"](
        """
        SELECT
            m.id,
            m.slug,
            m.title,
            m.condition_id,
            m.question_id,
            m.yes_token_id,
            m.no_token_id,
            m.category,
            m.tags,
            m.end_date,
            m.created_at,
            mlp.latest_yes_price AS latest_price,
            mlp.latest_trade_at,
            stats_24h.trade_count_24h,
            stats_24h.volume_24h,
            stats_24h.last_trade_at
        FROM markets m
        LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
        LEFT JOIN (
            SELECT
                market_id,
                SUM(trade_count) AS trade_count_24h,
                SUM(volume_notional) AS volume_24h,
                MAX(last_trade_at) AS last_trade_at
            FROM market_trade_daily_stats
            WHERE trade_date >= ?
            GROUP BY market_id
        ) stats_24h ON stats_24h.market_id = m.id
        WHERE m.end_date IS NULL OR m.end_date >= ?
        ORDER BY
            COALESCE(stats_24h.volume_24h, 0) DESC,
            COALESCE(stats_24h.trade_count_24h, 0) DESC,
            stats_24h.last_trade_at DESC,
            mlp.latest_trade_at DESC,
            m.created_at DESC
        LIMIT ?
        """,
        (ctx["utc_date_days_ago"](1), now_iso, raw_limit),
    )
    candidate_market_ids = [int(row["id"]) for row in candidate_rows if row.get("id") is not None]
    status_map: Dict[int, Dict[str, bool]] = {}
    if candidate_market_ids:
        placeholders = ", ".join("?" for _ in candidate_market_ids)
        status_rows = ctx["query_all"](
            f"""
            SELECT
                market_id,
                MAX(CASE WHEN event_status = 'settle' THEN 1 ELSE 0 END) AS has_settle,
                MAX(CASE WHEN event_status = 'propose' THEN 1 ELSE 0 END) AS has_propose
            FROM oracle_events
            WHERE market_id IN ({placeholders})
            GROUP BY market_id
            """,
            candidate_market_ids,
        )
        status_map = {
            int(row["market_id"]): {"has_settle": bool(row.get("has_settle")), "has_propose": bool(row.get("has_propose"))}
            for row in status_rows
            if row.get("market_id") is not None
        }
    rows: List[Dict[str, Any]] = []
    for row in candidate_rows:
        market_id = row.get("id")
        if market_id is None:
            continue
        flags = status_map.get(int(market_id), {})
        if flags.get("has_settle"):
            continue
        normalized = dict(row)
        normalized["status"] = "Proposed" if flags.get("has_propose") else "Active"
        rows.append(normalized)
        if len(rows) >= page_size:
            break
    return {
        "rows": rows,
        "items": [_normalize_bootstrap_market_item(ctx, row) for row in rows],
    }


def _select_featured_market_id(preview_rows: List[Dict[str, Any]]) -> Optional[int]:
    best_market_id: Optional[int] = None
    best_score: Optional[tuple] = None
    for row in preview_rows:
        market_id = row.get("id")
        if market_id is None:
            continue
        try:
            numeric_market_id = int(market_id)
        except (TypeError, ValueError):
            continue
        score = (
            _status_priority(row.get("status")),
            int(bool(str(row.get("yes_token_id") or "").strip()) and bool(str(row.get("no_token_id") or "").strip())),
            int(bool(row.get("last_trade_at") or row.get("latest_trade_at"))),
            _safe_float(row.get("volume_24h")),
            _safe_int(row.get("trade_count_24h")),
            str(row.get("last_trade_at") or row.get("latest_trade_at") or ""),
            str(row.get("end_date") or ""),
            str(row.get("created_at") or ""),
        )
        if best_score is None or score > best_score:
            best_score = score
            best_market_id = numeric_market_id
    return best_market_id


def _get_fallback_featured_market_id(ctx: dict) -> Optional[int]:
    now_iso = ctx["utc_now_iso"]()
    row = ctx["query_one"](
        """
        WITH settled_markets AS (
            SELECT DISTINCT market_id
            FROM oracle_events
            WHERE event_status = 'settle' AND market_id IS NOT NULL
        ),
        proposed_markets AS (
            SELECT DISTINCT market_id
            FROM oracle_events
            WHERE event_status = 'propose' AND market_id IS NOT NULL
        ),
        stats_24h AS (
            SELECT
                market_id,
                SUM(trade_count) AS trade_count_24h,
                SUM(volume_notional) AS volume_24h,
                MAX(last_trade_at) AS last_trade_at
            FROM market_trade_daily_stats
            WHERE trade_date >= ?
            GROUP BY market_id
        )
        SELECT m.id
        FROM markets m
        LEFT JOIN settled_markets settled ON settled.market_id = m.id
        LEFT JOIN proposed_markets proposed ON proposed.market_id = m.id
        LEFT JOIN stats_24h stats ON stats.market_id = m.id
        LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
        WHERE settled.market_id IS NULL
          AND (m.end_date IS NULL OR m.end_date >= ?)
        ORDER BY
            CASE WHEN proposed.market_id IS NULL THEN 1 ELSE 0 END DESC,
            CASE
                WHEN COALESCE(NULLIF(TRIM(m.yes_token_id), ''), '') <> ''
                 AND COALESCE(NULLIF(TRIM(m.no_token_id), ''), '') <> '' THEN 1
                ELSE 0
            END DESC,
            COALESCE(stats.volume_24h, 0) DESC,
            COALESCE(stats.trade_count_24h, 0) DESC,
            COALESCE(stats.last_trade_at, mlp.latest_trade_at, m.created_at) DESC
        LIMIT 1
        """,
        (ctx["utc_date_days_ago"](1), now_iso),
    )
    market_id = row.get("id") if row else None
    try:
        return int(market_id) if market_id is not None else None
    except (TypeError, ValueError):
        return None


def _build_bootstrap_price_preview(ctx: dict, market_id: int) -> Dict[str, Any]:
    summary_row = ctx["query_one"](
        """
        SELECT
            market_id,
            latest_price,
            latest_yes_price,
            latest_no_price,
            latest_trade_at
        FROM market_latest_prices
        WHERE market_id = ?
        LIMIT 1
        """,
        (market_id,),
    )
    stats_row = ctx["query_one"](
        """
        SELECT
            SUM(trade_count) AS trade_count_24h,
            SUM(volume_notional) AS volume_24h,
            MAX(last_trade_at) AS updated_at
        FROM market_trade_daily_stats
        WHERE market_id = ? AND trade_date >= ?
        """,
        (market_id, ctx["utc_date_days_ago"](1)),
    )
    return {
        "marketId": market_id,
        "latestPrice": summary_row.get("latest_price") if summary_row else None,
        "latestYesPrice": summary_row.get("latest_yes_price") if summary_row else None,
        "latestNoPrice": summary_row.get("latest_no_price") if summary_row else None,
        "change1h": None,
        "change24h": None,
        "volume24h": stats_row.get("volume_24h") if stats_row else None,
        "tradeCount24h": _safe_int(stats_row.get("trade_count_24h") if stats_row else 0),
        "updatedAt": (summary_row or {}).get("latest_trade_at") or (stats_row or {}).get("updated_at"),
    }


def _get_bootstrap_latest_content_preview(ctx: dict, limit: int = 8) -> List[Dict[str, Any]]:
    if not ctx["table_exists"]("content_items"):
        return []
    return ctx["get_latest_content_snapshot"](limit=limit).get("items", [])


def _store_bootstrap_payload(ctx: dict, payload: Dict[str, Any]) -> Dict[str, Any]:
    expires_at = time.monotonic() + ctx["BOOTSTRAP_CACHE_TTL_SECONDS"]
    with ctx["_bootstrap_cache_lock"]:
        ctx["_bootstrap_cache"]["value"] = payload
        ctx["_bootstrap_cache"]["expires_at"] = expires_at
        ctx["_bootstrap_cache"]["refresh_in_progress"] = False
    ctx["SNAPSHOT_STORE"].set(BOOTSTRAP_SNAPSHOT_NAMESPACE, BOOTSTRAP_CACHE_KEY, payload, ctx["BOOTSTRAP_CACHE_TTL_SECONDS"])
    ctx["set_cached_json"]("bootstrap", BOOTSTRAP_CACHE_KEY, payload, ctx["BOOTSTRAP_CACHE_TTL_SECONDS"])
    return payload


def _refresh_bootstrap_payload(ctx: dict, reason: str) -> Optional[Dict[str, Any]]:
    started_at = time.perf_counter()
    ctx["app"].logger.info("bootstrap-cache refresh-start reason=%s", reason)
    try:
        payload = build_bootstrap_payload(ctx)
    except Exception:
        with ctx["_bootstrap_cache_lock"]:
            ctx["_bootstrap_cache"]["refresh_in_progress"] = False
        ctx["app"].logger.exception("bootstrap-cache refresh-failed reason=%s", reason)
        return None
    _store_bootstrap_payload(ctx, payload)
    ctx["app"].logger.info(
        "bootstrap-cache refresh-done reason=%s duration_ms=%.2f",
        reason,
        (time.perf_counter() - started_at) * 1000,
    )
    return payload


def _schedule_bootstrap_refresh(ctx: dict, reason: str) -> None:
    thread = ctx["threading"].Thread(
        target=lambda: _refresh_bootstrap_payload(ctx, reason),
        name="polydata-bootstrap-refresh",
        daemon=True,
    )
    thread.start()


def build_bootstrap_payload(ctx: dict) -> Dict[str, Any]:
    preview_payload = ctx["get_bootstrap_component_cached"](
        "active-markets-preview-v2",
        lambda: _build_bootstrap_active_markets_payload(ctx, page_size=20),
        ttl_seconds=15,
    )
    preview_rows = preview_payload.get("rows", [])
    active_markets_preview = preview_payload.get("items", [])
    featured_market_id = _select_featured_market_id(preview_rows)
    if featured_market_id is None:
        featured_market_id = _get_fallback_featured_market_id(ctx)
    if featured_market_id is None:
        row = ctx["query_one"]("SELECT id FROM markets ORDER BY created_at DESC LIMIT 1")
        featured_market_id = row.get("id") if row else None

    featured_market = (
        ctx["get_bootstrap_component_cached"](f"featured-market:{int(featured_market_id)}", lambda: ctx["normalize_market"](ctx["get_market_by_id"](int(featured_market_id))))
        if featured_market_id is not None
        else None
    )
    recent_trade_preview = (
        ctx["get_bootstrap_component_cached"](
            f"recent-trades:{int(featured_market_id)}",
            lambda: ctx["get_trades_by_market_id"](int(featured_market_id), limit=12, offset=0),
            ttl_seconds=30,
        )
        if featured_market_id is not None
        else []
    )
    oracle_preview = (
        ctx["get_bootstrap_component_cached"](
            f"oracle-preview:{int(featured_market_id)}",
            lambda: ctx["get_oracle_events_by_market_id"](int(featured_market_id))[:8],
            ttl_seconds=60,
        )
        if featured_market_id is not None
        else []
    )
    if featured_market_id is not None and ctx["table_exists"]("content_items") and ctx["table_exists"]("content_links"):
        content_preview = ctx["get_bootstrap_component_cached"](
            f"content-preview:{int(featured_market_id)}",
            lambda: ctx["get_related_content_by_market_id"](int(featured_market_id), limit=6).get("items", []),
            ttl_seconds=300,
        )
    else:
        content_preview = []
    global_trades_preview = ctx["get_recent_trades_snapshot"](limit=18)
    global_oracle_preview = ctx["get_recent_oracle_snapshot"](limit=12)
    latest_content_preview = ctx["get_bootstrap_component_cached"](
        "latest-content-preview-v1",
        lambda: {"items": _get_bootstrap_latest_content_preview(ctx, limit=8)},
        ttl_seconds=300,
    ).get("items", [])
    system_health = ctx["get_bootstrap_component_cached"]("system-health", ctx["build_system_health_payload"], ttl_seconds=15)
    return {
        "generatedAt": ctx["utc_now_iso"](),
        "defaultWorkspace": {
            "name": "Hackathon Demo",
            "panels": [
                "active-markets","global-orderfilled","oracle-feed","market-summary","featured-market","world-brief","price-implications","price-chart","sample-chain-trades","oracle-timeline","related-news","related-video","report-feed","research-feed","alpha-signal","whale-tracker","suspicious-flow","commodities-watch","crypto-watch","nba-scoreboard","nba-intel","inflation-nowcast","bbo-monitor","lob-depth","live-api-status","system-health",
            ],
        },
        "featuredMarket": featured_market,
        "activeMarketsPreview": active_markets_preview,
        "globalTradesPreview": global_trades_preview,
        "globalOraclePreview": global_oracle_preview,
        "latestContentPreview": latest_content_preview,
        "recentTradesPreview": recent_trade_preview,
        "oraclePreview": oracle_preview,
        "contentPreview": content_preview,
        "pricePreview": _build_bootstrap_price_preview(ctx, int(featured_market_id)) if featured_market_id is not None else None,
        "systemHealth": system_health,
    }


def get_bootstrap_payload_cached(ctx: dict) -> Dict[str, Any]:
    redis_payload = ctx["get_cached_json"]("bootstrap", BOOTSTRAP_CACHE_KEY)
    if redis_payload is not None:
        ctx["app"].logger.info("bootstrap-cache redis-hit")
        ctx["SNAPSHOT_STORE"].set(BOOTSTRAP_SNAPSHOT_NAMESPACE, BOOTSTRAP_CACHE_KEY, redis_payload, ctx["BOOTSTRAP_CACHE_TTL_SECONDS"])
        with ctx["_bootstrap_cache_lock"]:
            ctx["_bootstrap_cache"]["value"] = redis_payload
            ctx["_bootstrap_cache"]["expires_at"] = time.monotonic() + ctx["BOOTSTRAP_CACHE_TTL_SECONDS"]
        return redis_payload
    now_monotonic = time.monotonic()
    cached = ctx["_bootstrap_cache"].get("value")
    if cached is not None and ctx["_bootstrap_cache"].get("expires_at", 0.0) > now_monotonic:
        ctx["app"].logger.info("bootstrap-cache hit ttl_remaining_ms=%.2f", (ctx["_bootstrap_cache"].get("expires_at", 0.0) - now_monotonic) * 1000)
        return cached
    with ctx["_bootstrap_cache_lock"]:
        cached = ctx["_bootstrap_cache"].get("value")
        if cached is not None and ctx["_bootstrap_cache"].get("expires_at", 0.0) > time.monotonic():
            ctx["app"].logger.info("bootstrap-cache hit-after-lock")
            return cached
        stale_payload = cached or ctx["SNAPSHOT_STORE"].get_stale(BOOTSTRAP_SNAPSHOT_NAMESPACE, BOOTSTRAP_CACHE_KEY)
        if stale_payload is not None:
            ctx["app"].logger.info("bootstrap-cache stale-hit scheduling_refresh=true")
            if cached is None:
                ctx["_bootstrap_cache"]["value"] = stale_payload
                ctx["_bootstrap_cache"]["expires_at"] = now_monotonic
            schedule_refresh = not ctx["_bootstrap_cache"].get("refresh_in_progress")
        else:
            schedule_refresh = False
        if stale_payload is not None:
            if schedule_refresh:
                ctx["_bootstrap_cache"]["refresh_in_progress"] = True
            else:
                ctx["app"].logger.info("bootstrap-cache stale-hit refresh_already_in_progress=true")
        else:
            ctx["app"].logger.info(
                "bootstrap-cache cold-rebuild ttl_seconds=%s component_ttl_seconds=%s",
                ctx["BOOTSTRAP_CACHE_TTL_SECONDS"],
                ctx["BOOTSTRAP_COMPONENT_TTL_SECONDS"],
            )
    if stale_payload is not None:
        if schedule_refresh:
            _schedule_bootstrap_refresh(ctx, "stale-hit")
        return stale_payload
    payload = _refresh_bootstrap_payload(ctx, "cold-miss")
    if payload is not None:
        return payload
    cached = ctx["_bootstrap_cache"].get("value")
    if cached is not None:
        return cached
    raise RuntimeError("bootstrap payload refresh failed")


def prewarm_snapshot_payloads(ctx: dict) -> None:
    tasks = [
        ("bootstrap:active-markets-preview", lambda: ctx["get_bootstrap_component_cached"](
            "active-markets-preview-v2",
            lambda: _build_bootstrap_active_markets_payload(ctx, page_size=20),
            ttl_seconds=15,
        )),
        ("oracle:12", lambda: ctx["get_recent_oracle_snapshot"](limit=12)),
        ("oracle:16", lambda: ctx["get_recent_oracle_snapshot"](limit=16)),
        ("trades:18", lambda: ctx["get_recent_trades_snapshot"](limit=18)),
        ("trades:24", lambda: ctx["get_recent_trades_snapshot"](limit=24)),
        ("content:8", lambda: ctx["get_bootstrap_component_cached"](
            "latest-content-preview-v1",
            lambda: {"items": _get_bootstrap_latest_content_preview(ctx, limit=8)},
            ttl_seconds=300,
        )),
        ("content:12", lambda: ctx["get_bootstrap_component_cached"](
            "latest-content-preview-v2",
            lambda: {"items": _get_bootstrap_latest_content_preview(ctx, limit=12)},
            ttl_seconds=300,
        )),
        ("bootstrap", ctx["get_bootstrap_payload_cached"]),
    ]
    for name, builder in tasks:
        started_at = time.perf_counter()
        try:
            builder()
            ctx["app"].logger.info("snapshot-prewarm done task=%s duration_ms=%.2f", name, (time.perf_counter() - started_at) * 1000)
        except Exception:
            ctx["app"].logger.exception("snapshot-prewarm failed task=%s", name)


def start_snapshot_prewarm_thread(ctx: dict) -> None:
    if not ctx["SNAPSHOT_PREWARM_ENABLED"]:
        ctx["app"].logger.info("snapshot-prewarm disabled")
        return
    def _runner() -> None:
        while True:
            prewarm_snapshot_payloads(ctx)
            time.sleep(SNAPSHOT_PREWARM_INTERVAL_SECONDS)

    thread = ctx["threading"].Thread(target=_runner, name="polydata-snapshot-prewarm", daemon=True)
    thread.start()
