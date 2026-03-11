#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""polyData dashboard API server."""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

# 保证 scripts 根目录在 path 中（支持从仓库根目录运行）
_scripts_root = Path(__file__).resolve().parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    from flask import Flask, g, jsonify, request
except ImportError:
    print("Error: flask not installed. pip install flask", file=sys.stderr)
    sys.exit(1)

try:
    from werkzeug.exceptions import HTTPException
except ImportError:
    HTTPException = Exception

from db import add_db_cli_args, configure_db_from_args, describe_db_target, dict_from_row, get_connection, init_schema, DEFAULT_DB_PATH

app = Flask(__name__)
DB_PATH = os.environ.get("POLYMARKET_DB", DEFAULT_DB_PATH)
DASHBOARD_CACHE_TTL_SECONDS = int(os.environ.get("POLYDATA_DASHBOARD_CACHE_TTL_SECONDS", "300"))
MARKETS_CACHE_TTL_SECONDS = int(os.environ.get("POLYDATA_MARKETS_CACHE_TTL_SECONDS", "60"))
RECENT_TRADE_WINDOW = int(os.environ.get("POLYDATA_DASHBOARD_TRADE_WINDOW", "250000"))
_dashboard_cache_lock = threading.Lock()
_dashboard_cache: Dict[str, Any] = {"value": None, "expires_at": 0.0}
_markets_cache_lock = threading.Lock()
_markets_cache: Dict[str, Dict[str, Any]] = {}


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    app.logger.handlers.clear()
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)
    app.logger.propagate = False


configure_logging()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    normalized = text.replace(" UTC", "Z").replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def iso_days_before(anchor: Optional[str], days: int) -> Optional[str]:
    parsed = parse_iso_datetime(anchor)
    if parsed is None:
        return None
    return (parsed - timedelta(days=days)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_json_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return data
        except Exception:
            return [item.strip() for item in text.split(",") if item.strip()]
    return [value]


def query_all(sql: str, params: Optional[Iterable[Any]] = None) -> List[Dict[str, Any]]:
    conn = get_connection(DB_PATH)
    cursor = conn.cursor()
    bound_params = tuple(params or ())
    try:
        cursor.execute(sql, bound_params)
        rows = [dict_from_row(row) for row in cursor.fetchall()]
        return rows
    except Exception:
        app.logger.exception(
            "SQL query_all failed sql=%s params=%s",
            " ".join(sql.split()),
            bound_params,
        )
        raise
    finally:
        conn.close()


def query_one(sql: str, params: Optional[Iterable[Any]] = None) -> Dict[str, Any]:
    conn = get_connection(DB_PATH)
    cursor = conn.cursor()
    bound_params = tuple(params or ())
    try:
        cursor.execute(sql, bound_params)
        row = dict_from_row(cursor.fetchone())
        return row
    except Exception:
        app.logger.exception(
            "SQL query_one failed sql=%s params=%s",
            " ".join(sql.split()),
            bound_params,
        )
        raise
    finally:
        conn.close()


@app.before_request
def log_request_start() -> None:
    g.request_started_at = time.perf_counter()
    g.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    app.logger.info(
        "request-start request_id=%s method=%s path=%s query=%s remote=%s",
        g.request_id,
        request.method,
        request.path,
        request.query_string.decode("utf-8", errors="replace"),
        request.headers.get("X-Forwarded-For", request.remote_addr),
    )


@app.after_request
def log_request_end(response):
    request_id = getattr(g, "request_id", "-")
    started_at = getattr(g, "request_started_at", None)
    duration_ms = (time.perf_counter() - started_at) * 1000 if started_at else -1
    response.headers["X-Request-ID"] = request_id
    app.logger.info(
        "request-end request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        request_id,
        request.method,
        request.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.errorhandler(HTTPException)
def handle_http_exception(error: HTTPException):
    request_id = getattr(g, "request_id", "-")
    app.logger.warning(
        "http-error request_id=%s method=%s path=%s status=%s detail=%s",
        request_id,
        request.method,
        request.path,
        getattr(error, "code", 500),
        getattr(error, "description", str(error)),
    )
    return jsonify({"error": getattr(error, "description", "HTTP error"), "requestId": request_id}), getattr(error, "code", 500)


@app.errorhandler(Exception)
def handle_unexpected_exception(error: Exception):
    request_id = getattr(g, "request_id", "-")
    app.logger.exception(
        "unhandled-error request_id=%s method=%s path=%s error=%s",
        request_id,
        request.method,
        request.path,
        error,
    )
    return jsonify({"error": "Internal server error", "requestId": request_id}), 500


def build_market_status_case(now_iso: str) -> str:
    return (
        "CASE "
        "WHEN EXISTS (SELECT 1 FROM oracle_events oe WHERE oe.market_id = m.id AND oe.event_status = 'settle') THEN 'Settled' "
        "WHEN EXISTS (SELECT 1 FROM oracle_events oe WHERE oe.market_id = m.id AND oe.event_status = 'propose') THEN 'Proposed' "
        "WHEN m.end_date IS NOT NULL AND m.end_date < ? THEN 'Closed' "
        "ELSE 'Active' END"
    )


def fetch_dashboard_market_status(now_iso: str) -> List[Dict[str, Any]]:
    return query_all(
        """
        SELECT status AS name, COUNT(*) AS value
        FROM (
            SELECT
                CASE
                    WHEN settled.market_id IS NOT NULL THEN 'Settled'
                    WHEN proposed.market_id IS NOT NULL THEN 'Proposed'
                    WHEN m.end_date IS NOT NULL AND m.end_date < ? THEN 'Closed'
                    ELSE 'Active'
                END AS status
            FROM markets m
            LEFT JOIN (
                SELECT DISTINCT market_id
                FROM oracle_events
                WHERE event_status = 'settle' AND market_id IS NOT NULL
            ) settled ON settled.market_id = m.id
            LEFT JOIN (
                SELECT DISTINCT market_id
                FROM oracle_events
                WHERE event_status = 'propose' AND market_id IS NOT NULL
            ) proposed ON proposed.market_id = m.id
        ) status_rows
        GROUP BY status
        ORDER BY value DESC
        """,
        (now_iso,),
    )


def fetch_recent_trade_window_bounds(window_size: int) -> Dict[str, Any]:
    return query_one(
        """
        SELECT
            COUNT(*) AS trade_count,
            MIN(timestamp) AS earliest_timestamp,
            MAX(timestamp) AS latest_timestamp
        FROM (
            SELECT timestamp
            FROM trades
            ORDER BY timestamp DESC
            LIMIT ?
        ) recent_trades
        """,
        (window_size,),
    )


def fetch_dashboard_trade_volume(window_size: int) -> List[Dict[str, Any]]:
    return query_all(
        """
        SELECT day, COUNT(*) AS trade_count
        FROM (
            SELECT substr(timestamp, 1, 10) AS day
            FROM trades
            ORDER BY timestamp DESC
            LIMIT ?
        ) recent_trades
        GROUP BY day
        ORDER BY day ASC
        """,
        (window_size,),
    )


def fetch_dashboard_recent_markets(now_iso: str, window_size: int) -> List[Dict[str, Any]]:
    status_case = build_market_status_case(now_iso)
    return query_all(
        f"""
        WITH recent_trades AS (
            SELECT market_id, timestamp, price, block_number, log_index
            FROM trades
            WHERE market_id IS NOT NULL
            ORDER BY timestamp DESC
            LIMIT ?
        ),
        activity AS (
            SELECT market_id, COUNT(*) AS trade_count, MAX(timestamp) AS last_trade_at
            FROM recent_trades
            GROUP BY market_id
            ORDER BY trade_count DESC, last_trade_at DESC
            LIMIT 5
        ),
        latest_price AS (
            SELECT market_id, price
            FROM (
                SELECT
                    market_id,
                    price,
                    ROW_NUMBER() OVER (
                        PARTITION BY market_id
                        ORDER BY timestamp DESC, block_number DESC, log_index DESC
                    ) AS row_num
                FROM recent_trades
            ) ranked_prices
            WHERE row_num = 1
        )
        SELECT
            m.id,
            m.slug,
            m.title,
            m.end_date,
            {status_case} AS status,
            activity.trade_count,
            activity.last_trade_at,
            latest_price.price AS latest_price
        FROM activity
        JOIN markets m ON m.id = activity.market_id
        LEFT JOIN latest_price ON latest_price.market_id = activity.market_id
        ORDER BY activity.trade_count DESC, activity.last_trade_at DESC
        """,
        (window_size, now_iso),
    )


def fetch_trade_count_estimate() -> Dict[str, Any]:
    return query_one(
        """
        SELECT
            COALESCE(table_rows, 0) AS table_rows,
            COALESCE(auto_increment, 0) AS auto_increment
        FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'trades'
        """
    )


def build_dashboard_payload() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace("+00:00", "Z")
    last_24h = (now - timedelta(hours=24)).isoformat().replace("+00:00", "Z")

    status_rows = fetch_dashboard_market_status(now_iso)
    active_markets = sum(
        int(row.get("value") or 0)
        for row in status_rows
        if row.get("name") in {"Active", "Proposed"}
    )
    settlements_row = query_one(
        """
        SELECT COUNT(*) AS settlements_24h
        FROM oracle_events
        WHERE event_status = 'settle' AND event_time >= ?
        """,
        (last_24h,),
    )
    trade_volume_rows = fetch_dashboard_trade_volume(RECENT_TRADE_WINDOW)
    recent_rows = fetch_dashboard_recent_markets(now_iso, RECENT_TRADE_WINDOW)
    trade_window = fetch_recent_trade_window_bounds(RECENT_TRADE_WINDOW)
    trade_count_estimate = fetch_trade_count_estimate()

    latest_trade_ts = trade_window.get("latest_timestamp")
    earliest_trade_ts = trade_window.get("earliest_timestamp")
    coverage_7d_start = iso_days_before(latest_trade_ts, 7)
    coverage_30d_start = iso_days_before(latest_trade_ts, 30)

    return {
        "metrics": {
            "activeMarkets": active_markets,
            "totalTrades": int(trade_count_estimate.get("table_rows") or 0),
            "settlements24h": int(settlements_row.get("settlements_24h") or 0),
        },
        "volume7d": trade_volume_rows[-7:],
        "volume30d": trade_volume_rows[-30:],
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
            "cacheTtlSeconds": DASHBOARD_CACHE_TTL_SECONDS,
            "tradeWindowSize": RECENT_TRADE_WINDOW,
            "tradeWindowEarliestTimestamp": earliest_trade_ts,
            "tradeWindowLatestTimestamp": latest_trade_ts,
            "tradeWindowCovers7d": bool(coverage_7d_start and earliest_trade_ts and earliest_trade_ts <= coverage_7d_start),
            "tradeWindowCovers30d": bool(coverage_30d_start and earliest_trade_ts and earliest_trade_ts <= coverage_30d_start),
            "totalTradesSource": "information_schema.table_rows",
            "totalTradesAutoIncrement": int(trade_count_estimate.get("auto_increment") or 0),
        },
    }


def get_dashboard_payload_cached() -> Dict[str, Any]:
    now_monotonic = time.monotonic()
    cached = _dashboard_cache.get("value")
    if cached is not None and _dashboard_cache.get("expires_at", 0.0) > now_monotonic:
        app.logger.info("dashboard-cache hit ttl_remaining_ms=%.2f", (_dashboard_cache.get("expires_at", 0.0) - now_monotonic) * 1000)
        return cached

    with _dashboard_cache_lock:
        cached = _dashboard_cache.get("value")
        if cached is not None and _dashboard_cache.get("expires_at", 0.0) > time.monotonic():
            app.logger.info("dashboard-cache hit-after-lock")
            return cached

        app.logger.info("dashboard-cache rebuild window_size=%s ttl_seconds=%s", RECENT_TRADE_WINDOW, DASHBOARD_CACHE_TTL_SECONDS)
        payload = build_dashboard_payload()
        _dashboard_cache["value"] = payload
        _dashboard_cache["expires_at"] = time.monotonic() + DASHBOARD_CACHE_TTL_SECONDS
        return payload


def get_markets_payload_cached(cache_key: str, builder) -> Dict[str, Any]:
    now_monotonic = time.monotonic()
    cached_entry = _markets_cache.get(cache_key)
    if cached_entry is not None and cached_entry.get("expires_at", 0.0) > now_monotonic:
        app.logger.info("markets-cache hit key=%s ttl_remaining_ms=%.2f", cache_key, (cached_entry["expires_at"] - now_monotonic) * 1000)
        return cached_entry["value"]

    with _markets_cache_lock:
        cached_entry = _markets_cache.get(cache_key)
        if cached_entry is not None and cached_entry.get("expires_at", 0.0) > time.monotonic():
            app.logger.info("markets-cache hit-after-lock key=%s", cache_key)
            return cached_entry["value"]

        payload = builder()
        _markets_cache[cache_key] = {
            "value": payload,
            "expires_at": time.monotonic() + MARKETS_CACHE_TTL_SECONDS,
        }
        expired_keys = [key for key, value in _markets_cache.items() if value.get("expires_at", 0.0) <= time.monotonic()]
        for key in expired_keys:
            _markets_cache.pop(key, None)
        return payload


def normalize_market(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "slug": row.get("slug"),
        "title": row.get("title"),
        "conditionId": row.get("condition_id"),
        "questionId": row.get("question_id"),
        "oracle": row.get("oracle"),
        "yesTokenId": row.get("yes_token_id"),
        "noTokenId": row.get("no_token_id"),
        "description": row.get("description") or "",
        "status": row.get("status") or "Unknown",
        "latestPrice": row.get("latest_price"),
        "latestYesPrice": row.get("latest_yes_price"),
        "latestNoPrice": row.get("latest_no_price"),
        "enableNegRisk": bool(row.get("enable_neg_risk")),
        "endDate": row.get("end_date"),
        "createdAt": row.get("created_at"),
        "category": row.get("category") or "Uncategorized",
        "tags": parse_json_list(row.get("tags")),
        "gammaMarketId": row.get("gamma_market_id"),
    }


def normalize_trade(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "txHash": row.get("tx_hash"),
        "logIndex": row.get("log_index"),
        "blockNumber": row.get("block_number"),
        "timestamp": row.get("timestamp"),
        "maker": row.get("maker"),
        "taker": row.get("taker"),
        "price": row.get("price"),
        "size": row.get("size"),
        "side": row.get("side"),
        "outcome": row.get("outcome"),
        "tokenId": row.get("token_id"),
        "marketId": row.get("market_id"),
        "orderHash": row.get("order_hash"),
        "makerAssetId": row.get("maker_asset_id"),
        "takerAssetId": row.get("taker_asset_id"),
        "makerAmount": row.get("maker_amount"),
        "takerAmount": row.get("taker_amount"),
        "fee": row.get("fee"),
        "contract": row.get("contract"),
    }


def normalize_oracle_event(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "txHash": row.get("tx_hash"),
        "blockNumber": row.get("block_number"),
        "eventTime": row.get("event_time"),
        "eventStatus": row.get("event_status"),
        "externalMarketId": row.get("external_market_id"),
        "marketId": row.get("market_id"),
        "marketTitle": row.get("market_title"),
        "matchedBy": row.get("matched_by"),
        "questionId": row.get("question_id"),
        "conditionId": row.get("condition_id"),
        "proposedPrice": row.get("proposed_price"),
        "settledPrice": row.get("settled_price"),
        "requester": row.get("requester"),
        "proposer": row.get("proposer"),
        "disputer": row.get("disputer"),
        "proposalTransaction": row.get("proposal_transaction"),
        "settlementTransaction": row.get("settlement_transaction"),
        "sourceAdapter": row.get("source_adapter"),
        "sourceOracle": row.get("source_oracle"),
    }


def get_market_by_slug(slug: str) -> Optional[dict]:
    now_iso = utc_now_iso()
    status_case = build_market_status_case(now_iso)
    market = query_one(
        f"""
        SELECT
            m.*,
            {status_case} AS status,
            (
                SELECT t.price FROM trades t
                WHERE t.market_id = m.id AND t.outcome = 'YES'
                ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                LIMIT 1
            ) AS latest_yes_price,
            (
                SELECT t.price FROM trades t
                WHERE t.market_id = m.id AND t.outcome = 'NO'
                ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                LIMIT 1
            ) AS latest_no_price,
            (
                SELECT t.price FROM trades t
                WHERE t.market_id = m.id
                ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                LIMIT 1
            ) AS latest_price
        FROM markets m
        WHERE m.slug = ? COLLATE NOCASE
        LIMIT 1
        """,
        (now_iso, slug),
    )
    return market or None


def get_trades_by_market_id(market_id: int, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    rows = query_all(
        """
        SELECT
            tx_hash, log_index, market_id, maker, taker, price, size, side, outcome,
            token_id, timestamp, block_number, order_hash, maker_asset_id, taker_asset_id,
            maker_amount, taker_amount, fee, contract
        FROM trades
        WHERE market_id = ?
        ORDER BY timestamp DESC, block_number DESC, log_index DESC
        LIMIT ? OFFSET ?
        """,
        (market_id, limit, offset),
    )
    return [normalize_trade(row) for row in rows]


def get_oracle_events_by_market_id(market_id: int) -> List[Dict[str, Any]]:
    rows = query_all(
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
    return [normalize_oracle_event(row) for row in rows]


def get_market_price_series(market_id: int, limit: int = 400) -> List[Dict[str, Any]]:
    rows = query_all(
        """
        SELECT timestamp, outcome, price, block_number, log_index
        FROM trades
        WHERE market_id = ?
        ORDER BY timestamp DESC, block_number DESC, log_index DESC
        LIMIT ?
        """,
        (market_id, limit),
    )
    rows.reverse()
    yes_price = None
    no_price = None
    points = []
    for row in rows:
        if row.get("outcome") == "YES":
            yes_price = row.get("price")
        elif row.get("outcome") == "NO":
            no_price = row.get("price")
        points.append({"timestamp": row.get("timestamp"), "yesPrice": yes_price, "noPrice": no_price})
    return points


@app.route("/dashboard", methods=["GET"])
def api_dashboard():
    return jsonify(get_dashboard_payload_cached())


@app.route("/search", methods=["GET"])
def api_search():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"items": []})
    pattern = f"%{query}%"
    rows = query_all(
        """
        SELECT id, slug, title, condition_id, question_id
        FROM markets
        WHERE title LIKE ? OR slug LIKE ? OR condition_id LIKE ? OR question_id LIKE ?
        ORDER BY created_at DESC
        LIMIT 10
        """,
        (pattern, pattern, pattern, pattern),
    )
    return jsonify(
        {
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
    )


@app.route("/markets", methods=["GET"])
def api_markets():
    now_iso = utc_now_iso()
    status = (request.args.get("status") or "active").strip().lower()
    query = (request.args.get("q") or "").strip()
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(50, max(1, int(request.args.get("pageSize", 20))))
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

    def build_payload() -> Dict[str, Any]:
        rows = query_all(
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
        ),
        latest_yes_trades AS (
            SELECT market_id, price
            FROM (
                SELECT
                    t.market_id,
                    t.price,
                    ROW_NUMBER() OVER (
                        PARTITION BY t.market_id
                        ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                    ) AS rn
                FROM trades t
                INNER JOIN paged_markets pm ON pm.id = t.market_id
                WHERE t.outcome = 'YES'
            ) ranked_trades
            WHERE rn = 1
        )
        SELECT
            pm.id,
            pm.slug,
            pm.title,
            pm.condition_id,
            pm.question_id,
            pm.category,
            pm.tags,
            pm.end_date,
            pm.status,
            latest_yes_trades.price AS latest_price
        FROM paged_markets pm
        LEFT JOIN latest_yes_trades ON latest_yes_trades.market_id = pm.id
        ORDER BY pm.end_date DESC, pm.created_at DESC
            """,
            row_params,
        )
        has_more = len(rows) > page_size
        visible_rows = rows[:page_size]

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
                    "tags": parse_json_list(row.get("tags")),
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

    return jsonify(get_markets_payload_cached(cache_key, build_payload))


@app.route("/markets/<int:market_id>/detail", methods=["GET"])
def api_market_detail_by_id(market_id: int):
    now_iso = utc_now_iso()
    status_case = build_market_status_case(now_iso)
    market = query_one(
        f"""
        SELECT
            m.*,
            {status_case} AS status,
            (
                SELECT t.price FROM trades t
                WHERE t.market_id = m.id AND t.outcome = 'YES'
                ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                LIMIT 1
            ) AS latest_yes_price,
            (
                SELECT t.price FROM trades t
                WHERE t.market_id = m.id AND t.outcome = 'NO'
                ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                LIMIT 1
            ) AS latest_no_price,
            (
                SELECT t.price FROM trades t
                WHERE t.market_id = m.id
                ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC
                LIMIT 1
            ) AS latest_price
        FROM markets m
        WHERE m.id = ?
        LIMIT 1
        """,
        (now_iso, market_id),
    )
    if not market:
        return jsonify({"error": "Market not found", "marketId": market_id}), 404

    return jsonify(
        {
            "market": normalize_market(market),
            "priceSeries": get_market_price_series(market_id),
            "trades": get_trades_by_market_id(market_id, limit=100, offset=0),
            "oracleEvents": get_oracle_events_by_market_id(market_id),
        }
    )


@app.route("/markets/<slug>", methods=["GET"])
def api_market_detail(slug: str):
    slug = slug.strip()
    if not slug:
        return jsonify({"error": "slug required"}), 400
    market = get_market_by_slug(slug)
    if not market:
        return jsonify({"error": "Market not found", "slug": slug}), 404
    return jsonify(normalize_market(market))


@app.route("/markets/<slug>/trades", methods=["GET"])
def api_market_trades(slug: str):
    slug = slug.strip()
    if not slug:
        return jsonify({"error": "slug required"}), 400
    market = get_market_by_slug(slug)
    if not market:
        return jsonify({"error": "Market not found", "slug": slug}), 404
    limit = min(int(request.args.get("limit", 100)), 500)
    offset = max(0, int(request.args.get("offset", 0)))
    return jsonify(get_trades_by_market_id(market["id"], limit=limit, offset=offset))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "database": describe_db_target()})


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Polymarket Indexer API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=5000, help="Bind port")
    add_db_cli_args(parser)

    args = parser.parse_args()
    configure_db_from_args(args)
    global DB_PATH
    DB_PATH = args.sqlite_path
    init_schema(db_path=DB_PATH)

    app.logger.info("Starting API server at http://%s:%s", args.host, args.port)
    app.logger.info("Database: %s", describe_db_target())
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()