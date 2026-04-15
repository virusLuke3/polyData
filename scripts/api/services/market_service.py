from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional


def search_markets(ctx: dict, query: str, limit: int = 10) -> Dict[str, Any]:
    cleaned = str(query or "").strip()
    if not cleaned:
        return {"items": []}
    pattern = f"%{cleaned}%"
    rows = ctx["query_all"](
        """
        SELECT id, slug, title, condition_id, question_id
        FROM markets
        WHERE title LIKE ? OR slug LIKE ? OR condition_id LIKE ? OR question_id LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (pattern, pattern, pattern, pattern, limit),
    )
    return {
        "items": [
            {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "conditionId": row.get("condition_id"),
                "questionId": row.get("question_id"),
            }
            for row in rows
        ]
    }


def get_market_by_slug(ctx: dict, slug: str) -> Optional[dict]:
    now_iso = ctx["utc_now_iso"]()
    status_case = ctx["build_market_status_case"](now_iso)
    market = ctx["query_one"](
        f"""
        SELECT
            m.*,
            {status_case} AS status,
            mlp.latest_yes_price,
            mlp.latest_no_price,
            mlp.latest_price
        FROM markets m
        LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
        WHERE m.slug = ? COLLATE NOCASE
        LIMIT 1
        """,
        (now_iso, slug),
    )
    return market or None


def get_market_by_id(ctx: dict, market_id: int) -> Optional[dict]:
    now_iso = ctx["utc_now_iso"]()
    status_case = ctx["build_market_status_case"](now_iso)
    market = ctx["query_one"](
        f"""
        SELECT
            m.*,
            {status_case} AS status,
            mlp.latest_yes_price,
            mlp.latest_no_price,
            mlp.latest_price
        FROM markets m
        LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
        WHERE m.id = ?
        LIMIT 1
        """,
        (now_iso, market_id),
    )
    return market or None


def get_trades_by_market_id(ctx: dict, market_id: int, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    trade_source = ctx["get_existing_trade_read_source"]()
    if trade_source is None:
        return []
    if ctx["_identifier_name"](trade_source) == ctx["TRADE_V2_CORE_TABLE"]:
        rows = ctx["query_all"](
            f"""
            SELECT
                {ctx['get_trade_market_projection_sql']('t')}
            FROM {trade_source} t
            WHERE t.market_id = ?
            ORDER BY t.block_time DESC, t.block_number DESC, t.log_index DESC
            LIMIT ? OFFSET ?
            """,
            (market_id, limit, offset),
        )
    else:
        rows = ctx["query_all"](
            f"""
            SELECT
                tx_hash, log_index, market_id, maker, taker, price, size, side, outcome,
                token_id, timestamp, block_number, order_hash, maker_asset_id, taker_asset_id,
                maker_amount, taker_amount, fee, contract
            FROM {trade_source}
            WHERE market_id = ?
            ORDER BY timestamp DESC, block_number DESC, log_index DESC
            LIMIT ? OFFSET ?
            """,
            (market_id, limit, offset),
        )
    return [ctx["normalize_trade"](row) for row in rows]


def get_recent_trades_snapshot(ctx: dict, limit: int = 24) -> List[Dict[str, Any]]:
    cache_key = json.dumps({"limit": limit}, sort_keys=True, ensure_ascii=True)
    return ctx["get_snapshot_payload"](
        "snapshot:trades_recent",
        cache_key,
        lambda: ctx["get_recent_trades"](limit=limit),
        ttl_seconds=15,
    )


def get_oracle_events_by_market_id(ctx: dict, market_id: int) -> List[Dict[str, Any]]:
    rows = ctx["query_all"](
        """
        SELECT
            id, tx_hash, block_number, event_time, event_status, external_market_id,
            market_id, market_title, matched_by, question_id, condition_id,
            proposed_price, settled_price, requester, proposer, disputer,
            proposal_transaction, settlement_transaction, source_adapter, source_oracle
        FROM oracle_events
        WHERE market_id = ?
        ORDER BY block_number ASC, id ASC
        """,
        (market_id,),
    )
    return [ctx["normalize_oracle_event"](row) for row in rows]


def get_recent_oracle_snapshot(ctx: dict, limit: int = 24) -> List[Dict[str, Any]]:
    cache_key = json.dumps({"limit": limit}, sort_keys=True, ensure_ascii=True)
    return ctx["get_snapshot_payload"](
        "snapshot:oracle_recent",
        cache_key,
        lambda: ctx["get_recent_oracle_events"](limit=limit),
        ttl_seconds=30,
    )


def get_market_price_summary(ctx: dict, market_id: int) -> Dict[str, Any]:
    market = get_market_by_id(ctx, market_id)
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
    latest_price = summary_row.get("latest_price")
    latest_yes_price = summary_row.get("latest_yes_price")
    latest_no_price = summary_row.get("latest_no_price")
    updated_at = summary_row.get("latest_trade_at")
    clob_snapshot = ctx["get_market_clob_price_snapshot"](market)
    if clob_snapshot:
        latest_price = clob_snapshot.get("latestPrice") or latest_price
        latest_yes_price = clob_snapshot.get("latestYesPrice") or latest_yes_price
        latest_no_price = clob_snapshot.get("latestNoPrice") or latest_no_price
        updated_at = clob_snapshot.get("updatedAt") or updated_at

    trade_source = ctx["get_existing_trade_read_source"]()
    if trade_source is None:
        recent_stats = {"price_24h_ago": None, "price_1h_ago": None, "trade_count_24h": 0, "volume_24h": 0}
    elif ctx["_identifier_name"](trade_source) == ctx["TRADE_V2_CORE_TABLE"]:
        recent_stats = ctx["query_one"](
            f"""
            SELECT
                MAX(CASE WHEN block_time >= ? THEN price END) AS price_24h_ago,
                MAX(CASE WHEN block_time >= ? THEN price END) AS price_1h_ago,
                SUM(CASE WHEN block_time >= ? THEN 1 ELSE 0 END) AS trade_count_24h,
                COALESCE(SUM(CASE WHEN block_time >= ? THEN size * price END), 0) AS volume_24h
            FROM {trade_source}
            WHERE market_id = ?
            """,
            (
                ctx["iso_days_before"](updated_at, 1) if updated_at else ctx["utc_date_days_ago"](1),
                (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                ctx["iso_days_before"](updated_at, 1) if updated_at else ctx["utc_date_days_ago"](1),
                ctx["iso_days_before"](updated_at, 1) if updated_at else ctx["utc_date_days_ago"](1),
                market_id,
            ),
        )
    else:
        recent_stats = ctx["query_one"](
            f"""
            SELECT
                MAX(CASE WHEN timestamp >= ? THEN price END) AS price_24h_ago,
                MAX(CASE WHEN timestamp >= ? THEN price END) AS price_1h_ago,
                COUNT(*) AS trade_count_24h,
                COALESCE(SUM(CASE WHEN timestamp >= ? THEN size * price END), 0) AS volume_24h
            FROM {trade_source}
            WHERE market_id = ?
            """,
            (
                ctx["iso_days_before"](updated_at, 1) if updated_at else ctx["utc_date_days_ago"](1),
                (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                ctx["iso_days_before"](updated_at, 1) if updated_at else ctx["utc_date_days_ago"](1),
                market_id,
            ),
        )

    def _change(current: Any, past: Any) -> Optional[str]:
        if current in (None, "") or past in (None, ""):
            return None
        try:
            delta = Decimal(str(current)) - Decimal(str(past))
        except (InvalidOperation, ValueError, TypeError):
            return None
        return format(delta, "f")

    return {
        "marketId": market_id,
        "latestPrice": ctx["format_trade_decimal"](latest_price),
        "latestYesPrice": ctx["format_trade_decimal"](latest_yes_price),
        "latestNoPrice": ctx["format_trade_decimal"](latest_no_price),
        "change1h": clob_snapshot.get("change1h") if clob_snapshot else _change(latest_price, recent_stats.get("price_1h_ago")),
        "change24h": clob_snapshot.get("change24h") if clob_snapshot else _change(latest_price, recent_stats.get("price_24h_ago")),
        "volume24h": ctx["format_trade_decimal"](recent_stats.get("volume_24h")),
        "tradeCount24h": int(recent_stats.get("trade_count_24h") or 0),
        "updatedAt": updated_at,
    }


def get_market_chart_payload(ctx: dict, market_id: int, range_name: str = "1d", interval: str = "5m") -> Dict[str, Any]:
    market = get_market_by_id(ctx, market_id)
    points = ctx["get_market_clob_price_series"](market, range_name=range_name, interval=interval)
    if not points:
        limit = 400
        if range_name == "7d":
            limit = 700
        points = ctx["get_trade_derived_market_price_series"](market_id, limit=limit)
    return {"marketId": market_id, "range": range_name, "interval": interval, "points": points}


def get_market_oracle_payload(ctx: dict, market_id: int) -> Dict[str, Any]:
    market = get_market_by_id(ctx, market_id)
    if not market:
        return {"error": "Market not found", "marketId": market_id, "_status": 404}
    return {
        "marketId": market_id,
        "questionId": market.get("question_id"),
        "oracle": market.get("oracle"),
        "currentStatus": market.get("status"),
        "timeline": get_oracle_events_by_market_id(ctx, market_id),
    }


def enrich_market_rows_with_runtime_prices(ctx: dict, rows: List[Dict[str, Any]], *, max_updates: int = 18) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    enriched_rows: List[Dict[str, Any]] = [dict(row) for row in rows]
    candidates: List[tuple[int, Dict[str, Any]]] = []
    for index, normalized in enumerate(enriched_rows):
        latest_trade_at = ctx["parse_iso_datetime"](normalized.get("latest_trade_at"))
        is_stale = latest_trade_at is None or (now - latest_trade_at) > timedelta(hours=6)
        needs_runtime_price = normalized.get("latest_price") in (None, "") or is_stale
        if needs_runtime_price and len(candidates) < max_updates:
            candidates.append((index, normalized))
    if not candidates:
        return enriched_rows
    max_workers = min(6, len(candidates))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(ctx["get_market_clob_price_snapshot"], candidate): index for index, candidate in candidates}
        for future in as_completed(future_map):
            index = future_map[future]
            try:
                snapshot = future.result()
            except Exception:
                ctx["app"].logger.exception("runtime market price enrichment failed index=%s", index)
                continue
            runtime_price = snapshot.get("latestPrice") if snapshot else None
            if runtime_price not in (None, ""):
                enriched_rows[index]["latest_price"] = runtime_price
    return enriched_rows


def get_markets_payload(
    ctx: dict,
    *,
    status: str = "active",
    query: str = "",
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    now_iso = ctx["utc_now_iso"]()
    status = str(status or "active").strip().lower()
    query = str(query or "").strip()
    page = max(1, int(page))
    page_size = min(500, max(1, int(page_size)))
    offset = (page - 1) * page_size

    filters: List[str] = []
    params: List[Any] = []
    if status == "active":
        filters.append("(settled.market_id IS NULL AND (proposed.market_id IS NOT NULL OR m.end_date IS NULL OR m.end_date >= ?))")
        params.append(now_iso)
    elif status == "closed":
        filters.append("(settled.market_id IS NOT NULL OR (settled.market_id IS NULL AND proposed.market_id IS NULL AND m.end_date IS NOT NULL AND m.end_date < ?))")
        params.append(now_iso)
    if query:
        pattern = f"%{query}%"
        filters.append("(m.title LIKE ? OR m.slug LIKE ? OR m.condition_id LIKE ? OR m.question_id LIKE ?)")
        params.extend([pattern, pattern, pattern, pattern])

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    row_params = [now_iso, *params, page_size + 1, offset]
    cache_key = json.dumps({"status": status, "query": query, "page": page, "pageSize": page_size}, sort_keys=True, ensure_ascii=True)

    if status == "active" and not query and page == 1:
        return get_active_markets_snapshot(ctx, page_size=page_size)

    def build_payload() -> Dict[str, Any]:
        rows = ctx["query_all"](
            f"""
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
            filtered_markets AS (
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
                    CASE
                        WHEN settled.market_id IS NOT NULL THEN 'Settled'
                        WHEN proposed.market_id IS NOT NULL THEN 'Proposed'
                        WHEN m.end_date IS NOT NULL AND m.end_date < ? THEN 'Closed'
                        ELSE 'Active'
                    END AS status
                FROM markets m
                LEFT JOIN settled_markets settled ON settled.market_id = m.id
                LEFT JOIN proposed_markets proposed ON proposed.market_id = m.id
                {where_clause}
            ),
            paged_markets AS (
                SELECT *
                FROM filtered_markets
                ORDER BY end_date DESC, created_at DESC
                LIMIT ? OFFSET ?
            )
            SELECT
                pm.id,
                pm.slug,
                pm.title,
                pm.condition_id,
                pm.question_id,
                pm.yes_token_id,
                pm.no_token_id,
                pm.category,
                pm.tags,
                pm.end_date,
                pm.status,
                mlp.latest_yes_price AS latest_price,
                mlp.latest_trade_at
            FROM paged_markets pm
            LEFT JOIN market_latest_prices mlp ON mlp.market_id = pm.id
            ORDER BY pm.end_date DESC, pm.created_at DESC
            """,
            row_params,
        )
        has_more = len(rows) > page_size
        max_runtime_updates = min(page_size, 8 if page_size >= 120 else (10 if page_size >= 60 else 16))
        visible_rows = enrich_market_rows_with_runtime_prices(ctx, rows[:page_size], max_updates=max_runtime_updates)
        return {
            "items": [
                {
                    "id": row.get("id"),
                    "slug": row.get("slug"),
                    "title": row.get("title"),
                    "conditionId": row.get("condition_id"),
                    "questionId": row.get("question_id"),
                    "endDate": row.get("end_date"),
                    "latestPrice": row.get("latest_price"),
                    "status": row.get("status"),
                    "category": row.get("category") or "Uncategorized",
                    "tags": ctx["parse_json_list"](row.get("tags")),
                }
                for row in visible_rows
            ],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": offset + len(visible_rows) + (1 if has_more else 0),
                "totalPages": page + (1 if has_more else 0),
                "hasMore": has_more,
            },
        }

    return ctx["get_markets_payload_cached"](cache_key, build_payload)


def build_active_markets_payload(ctx: dict, page_size: int = 40) -> Dict[str, Any]:
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
            mlp.latest_trade_at
        FROM markets m
        LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
        WHERE m.end_date IS NULL OR m.end_date >= ?
        ORDER BY m.end_date DESC, m.created_at DESC
        LIMIT ?
        """,
        (now_iso, raw_limit),
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
    rows = enrich_market_rows_with_runtime_prices(ctx, rows, max_updates=min(page_size, 10 if page_size >= 40 else 16))
    return {
        "items": [
            {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "conditionId": row.get("condition_id"),
                "questionId": row.get("question_id"),
                "endDate": row.get("end_date"),
                "latestPrice": row.get("latest_price"),
                "status": row.get("status"),
                "category": row.get("category") or "Uncategorized",
                "tags": ctx["parse_json_list"](row.get("tags")),
            }
            for row in rows
        ],
        "pagination": {"page": 1, "pageSize": page_size, "total": len(rows), "totalPages": 1, "hasMore": False},
    }


def get_active_markets_snapshot(ctx: dict, page_size: int = 40) -> Dict[str, Any]:
    cache_key = json.dumps({"page": 1, "pageSize": page_size, "status": "active"}, sort_keys=True, ensure_ascii=True)
    return ctx["get_snapshot_payload"](
        "snapshot:markets_active",
        cache_key,
        lambda: build_active_markets_payload(ctx, page_size=page_size),
        ttl_seconds=60,
    )


def get_market_detail_payload(ctx: dict, market_id: int) -> Dict[str, Any]:
    market = get_market_by_id(ctx, market_id)
    if not market:
        return {"error": "Market not found", "marketId": market_id, "_status": 404}
    return {
        "market": ctx["normalize_market"](market),
        "priceSeries": get_market_chart_payload(ctx, market_id).get("points", []),
        "trades": get_trades_by_market_id(ctx, market_id, limit=100, offset=0),
        "oracleEvents": get_oracle_events_by_market_id(ctx, market_id),
    }
