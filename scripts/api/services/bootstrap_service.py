from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List


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


def build_bootstrap_payload(ctx: dict) -> Dict[str, Any]:
    active_markets_preview = ctx["get_active_markets_snapshot"](page_size=20).get("items", [])
    featured_market_id = None

    def _candidate_ids() -> List[int]:
        ids: List[int] = []
        for row in active_markets_preview:
            status = str(row.get("status") or "").strip().lower()
            market_id = row.get("id")
            if status not in {"active", "proposed"} or market_id is None:
                continue
            try:
                ids.append(int(market_id))
            except (TypeError, ValueError):
                continue
        return ids

    for market_id in _candidate_ids()[:6]:
        market = ctx["get_market_by_id"](market_id)
        if not market:
            continue
        yes_token_id = str(market.get("yes_token_id") or "").strip()
        no_token_id = str(market.get("no_token_id") or "").strip()
        if not yes_token_id or not no_token_id:
            continue
        try:
            ctx["LOB_RUNTIME_MANAGER"].get_market_snapshot(
                market_id=market_id,
                yes_token_id=yes_token_id,
                no_token_id=no_token_id,
                market_title=str(market.get("title") or ""),
            )
            featured_market_id = market_id
            break
        except Exception:
            continue
    if featured_market_id is None:
        active_rows = ctx["query_all"](
            """
            WITH settled_markets AS (
                SELECT DISTINCT market_id
                FROM oracle_events
                WHERE event_status = 'settle' AND market_id IS NOT NULL
            )
            SELECT m.id
            FROM markets m
            LEFT JOIN settled_markets settled ON settled.market_id = m.id
            WHERE settled.market_id IS NULL
              AND (m.end_date IS NULL OR m.end_date >= ?)
            ORDER BY m.end_date DESC, m.created_at DESC
            LIMIT 40
            """,
            (ctx["utc_now_iso"](),),
        )
        for row in active_rows:
            market_id = row.get("id")
            if market_id is None:
                continue
            market = ctx["get_market_by_id"](int(market_id))
            if not market:
                continue
            yes_token_id = str(market.get("yes_token_id") or "").strip()
            no_token_id = str(market.get("no_token_id") or "").strip()
            if not yes_token_id or not no_token_id:
                continue
            try:
                ctx["LOB_RUNTIME_MANAGER"].get_market_snapshot(
                    market_id=int(market_id),
                    yes_token_id=yes_token_id,
                    no_token_id=no_token_id,
                    market_title=str(market.get("title") or ""),
                )
                featured_market_id = int(market_id)
                break
            except Exception:
                continue
    if featured_market_id is None:
        for market_id in _candidate_ids():
            featured_market_id = market_id
            break
    if featured_market_id is None:
        row = ctx["query_one"](
            """
            WITH settled_markets AS (
                SELECT DISTINCT market_id
                FROM oracle_events
                WHERE event_status = 'settle' AND market_id IS NOT NULL
            )
            SELECT m.id
            FROM markets m
            LEFT JOIN settled_markets settled ON settled.market_id = m.id
            WHERE settled.market_id IS NULL
            ORDER BY m.end_date DESC, m.created_at DESC
            LIMIT 1
            """
        )
        featured_market_id = row.get("id")
    if featured_market_id is None:
        row = ctx["query_one"]("SELECT id FROM markets ORDER BY created_at DESC LIMIT 1")
        featured_market_id = row.get("id")

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
    price_preview = (
        ctx["get_bootstrap_component_cached"](
            f"price-preview:{int(featured_market_id)}",
            lambda: ctx["get_market_price_summary"](int(featured_market_id)),
            ttl_seconds=30,
        )
        if featured_market_id is not None
        else {}
    )
    global_trades_preview = ctx["get_recent_trades_snapshot"](limit=18)
    global_oracle_preview = ctx["get_recent_oracle_snapshot"](limit=12)
    latest_content_preview = ctx["get_latest_content_snapshot"](limit=8).get("items", [])
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
        "pricePreview": price_preview,
        "systemHealth": system_health,
    }


def get_bootstrap_payload_cached(ctx: dict) -> Dict[str, Any]:
    redis_cache_key = "workspace-default-v1"
    redis_payload = ctx["get_cached_json"]("bootstrap", redis_cache_key)
    if redis_payload is not None:
        ctx["app"].logger.info("bootstrap-cache redis-hit")
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
        ctx["app"].logger.info(
            "bootstrap-cache rebuild ttl_seconds=%s component_ttl_seconds=%s",
            ctx["BOOTSTRAP_CACHE_TTL_SECONDS"],
            ctx["BOOTSTRAP_COMPONENT_TTL_SECONDS"],
        )
        payload = build_bootstrap_payload(ctx)
        ctx["_bootstrap_cache"]["value"] = payload
        ctx["_bootstrap_cache"]["expires_at"] = time.monotonic() + ctx["BOOTSTRAP_CACHE_TTL_SECONDS"]
        ctx["set_cached_json"]("bootstrap", redis_cache_key, payload, ctx["BOOTSTRAP_CACHE_TTL_SECONDS"])
        return payload


def prewarm_snapshot_payloads(ctx: dict) -> None:
    tasks = [
        ("markets:20", lambda: ctx["get_active_markets_snapshot"](page_size=20)),
        ("markets:40", lambda: ctx["get_active_markets_snapshot"](page_size=40)),
        ("oracle:12", lambda: ctx["get_recent_oracle_snapshot"](limit=12)),
        ("oracle:16", lambda: ctx["get_recent_oracle_snapshot"](limit=16)),
        ("trades:18", lambda: ctx["get_recent_trades_snapshot"](limit=18)),
        ("trades:24", lambda: ctx["get_recent_trades_snapshot"](limit=24)),
        ("content:8", lambda: ctx["get_latest_content_snapshot"](limit=8)),
        ("content:12", lambda: ctx["get_latest_content_snapshot"](limit=12)),
        ("commodities", lambda: ctx["get_market_group_snapshot"](ctx["COMMODITY_SYMBOLS"], kind="commodities")),
        ("crypto", lambda: ctx["get_market_group_snapshot"](ctx["CRYPTO_SYMBOLS"], kind="crypto")),
        ("nba", lambda: ctx["get_nba_scoreboard_snapshot"](limit=10)),
        ("nba-intel", lambda: ctx["get_nba_intel_snapshot"](limit=12)),
        ("inflation-nowcast", ctx["get_inflation_nowcast_snapshot"]),
        ("whales", lambda: ctx["get_whale_trades_snapshot"](limit=14)),
        ("suspicious", lambda: ctx["get_suspicious_trades_snapshot"](limit=12)),
        ("alpha", lambda: ctx["get_alpha_signal_snapshot"](limit=8)),
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
    thread = ctx["threading"].Thread(target=lambda: prewarm_snapshot_payloads(ctx), name="polydata-snapshot-prewarm", daemon=True)
    thread.start()
