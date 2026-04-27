from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from urllib.parse import unquote


ACTIVE_MARKETS_SNAPSHOT_NAMESPACE = "snapshot:markets_active_v5"
DEFAULT_ACTIVE_MARKET_EXCLUSION_SQL = """
    INSTR(LOWER(COALESCE(m.tags, '')), 'hide-from-new') = 0
    AND INSTR(LOWER(COALESCE(m.tags, '')), 'recurring') = 0
    AND INSTR(LOWER(COALESCE(m.tags, '')), 'onchain-registry') = 0
    AND INSTR(LOWER(COALESCE(m.slug, '')), 'updown-5m') = 0
    AND INSTR(LOWER(COALESCE(m.slug, '')), 'updown-15m') = 0
    AND INSTR(LOWER(COALESCE(m.title, '')), ' up or down - ') = 0
"""

def _default_active_market_activity_sql(stats_alias: str) -> str:
    return f"""
    (
        COALESCE({stats_alias}.trade_count_24h, 0) > 0
        OR COALESCE({stats_alias}.volume_24h, 0) > 0
        OR {stats_alias}.last_trade_at IS NOT NULL
        OR {stats_alias}.latest_trade_at IS NOT NULL
    )
    """

PRICE_TARGET_RE = re.compile(r"\b(?:hit|reach)\s+\$+\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kmb])?\b", re.IGNORECASE)
PAIR_RE = re.compile(r"\b([A-Z0-9]{2,12}/[A-Z0-9]{2,12})\b")
YAHOO_QUOTE_RE = re.compile(r"finance\.yahoo\.com/quote/([^/?\"' )]+)", re.IGNORECASE)

NAME_TO_YAHOO_SYMBOL = {
    "bitcoin": "BTC-USD",
    "btc": "BTC-USD",
    "ethereum": "ETH-USD",
    "eth": "ETH-USD",
    "solana": "SOL-USD",
    "sol": "SOL-USD",
    "xrp": "XRP-USD",
    "dogecoin": "DOGE-USD",
    "doge": "DOGE-USD",
    "s&p 500": "^GSPC",
    "spx": "^GSPC",
    "nasdaq 100": "^NDX",
    "ndx": "^NDX",
    "gold": "GC=F",
    "silver": "SI=F",
    "oil": "CL=F",
}


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def markets_runtime_prices_enabled() -> bool:
    return _env_flag("POLYDATA_MARKETS_RUNTIME_PRICES", False)


def markets_latest_snapshot_fallback_enabled() -> bool:
    return _env_flag("POLYDATA_MARKETS_LATEST_SNAPSHOT_FALLBACK", True)


def _trim_active_markets_payload(ctx: dict, payload: Any, page_size: int) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None
    source_page_size = len(items)
    pagination = payload.get("pagination")
    if isinstance(pagination, dict):
        try:
            source_page_size = int(pagination.get("pageSize") or source_page_size)
        except (TypeError, ValueError):
            source_page_size = len(items)
    if len(items) < page_size and source_page_size < page_size:
        return None
    trimmed_items = items[:page_size]
    return {
        **payload,
        "items": trimmed_items,
        "pagination": {
            "page": 1,
            "pageSize": page_size,
            "total": len(trimmed_items),
            "totalPages": 1,
            "hasMore": len(items) > page_size,
        },
    }


def _normalized_gamma_active_keys(ctx: dict) -> tuple[set[str], set[str]]:
    get_filter = ctx.get("get_gamma_active_market_filter")
    if not callable(get_filter):
        return set(), set()
    payload = get_filter() or {}
    condition_ids = {
        str(value or "").strip().lower()
        for value in (payload.get("conditionIds") or [])
        if str(value or "").strip()
    }
    slugs = {
        str(value or "").strip().lower()
        for value in (payload.get("slugs") or [])
        if str(value or "").strip()
    }
    return condition_ids, slugs


def _filter_candidate_rows_to_gamma_active(ctx: dict, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    condition_ids, slugs = _normalized_gamma_active_keys(ctx)
    if not condition_ids and not slugs:
        return rows
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        condition_id = str(row.get("condition_id") or "").strip().lower()
        slug = str(row.get("slug") or "").strip().lower()
        if condition_id and condition_id in condition_ids:
            filtered.append(row)
            continue
        if slug and slug in slugs:
            filtered.append(row)
    return filtered


def _prefer_gamma_active_candidate_rows(ctx: dict, rows: List[Dict[str, Any]], target_count: int) -> List[Dict[str, Any]]:
    """Prefer Gamma-confirmed markets, then fill from DB-active rows like PolyWorld."""
    gamma_rows = _filter_candidate_rows_to_gamma_active(ctx, rows)
    if len(gamma_rows) >= target_count:
        return gamma_rows
    if not gamma_rows:
        return rows

    seen_ids = {int(row["id"]) for row in gamma_rows if row.get("id") is not None}
    fallback_rows = [row for row in rows if row.get("id") is None or int(row["id"]) not in seen_ids]
    return [*gamma_rows, *fallback_rows]


def _blend_recent_candidate_rows(volume_rows: List[Dict[str, Any]], recent_rows: List[Dict[str, Any]], target_count: int) -> List[Dict[str, Any]]:
    if not recent_rows:
        return volume_rows
    target_count = max(1, int(target_count))
    recent_count = max(target_count, min(len(recent_rows), target_count * 2))

    blended: List[Dict[str, Any]] = []
    seen_ids: set[int] = set()

    def append_rows(rows: List[Dict[str, Any]], limit: Optional[int] = None) -> None:
        added = 0
        for row in rows:
            market_id = row.get("id")
            if market_id is not None:
                numeric_id = int(market_id)
                if numeric_id in seen_ids:
                    continue
                seen_ids.add(numeric_id)
            blended.append(row)
            added += 1
            if limit is not None and added >= limit:
                break

    append_rows(recent_rows, recent_count)
    append_rows(volume_rows)
    append_rows(recent_rows)
    return blended


def _decimal_from_any(value: Any) -> Optional[Decimal]:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _is_tradeable_probability(value: Any) -> bool:
    price = _decimal_from_any(value)
    if price is None:
        return True
    return Decimal("0.01") < price < Decimal("0.99")


def _has_recent_trade_window(row: Dict[str, Any]) -> bool:
    trade_count = int(row.get("trade_count_24h") or 0)
    volume_24h = _decimal_from_any(row.get("volume_24h"))
    return trade_count > 0 or (volume_24h is not None and volume_24h > 0)


def _filter_tradeable_market_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        if not _has_recent_trade_window(row):
            continue
        if not _is_tradeable_probability(row.get("latest_price")):
            continue
        filtered.append(row)
    return filtered


def _prefer_tradeable_market_rows(rows: List[Dict[str, Any]], target_count: int) -> List[Dict[str, Any]]:
    """Prefer liquid/recent markets, then fill from active rows instead of collapsing the panel."""
    tradeable_rows = _filter_tradeable_market_rows(rows)
    if len(tradeable_rows) >= target_count:
        return tradeable_rows
    if not tradeable_rows:
        return rows

    seen_ids = {int(row["id"]) for row in tradeable_rows if row.get("id") is not None}
    fallback_rows = [row for row in rows if row.get("id") is None or int(row["id"]) not in seen_ids]
    return [*tradeable_rows, *fallback_rows]


def _parse_numeric_target(value: str, suffix: str | None = None) -> Optional[float]:
    text = str(value or "").replace(",", "").strip()
    if not text:
        return None
    try:
        numeric = float(text)
    except (TypeError, ValueError):
        return None
    normalized_suffix = str(suffix or "").strip().lower()
    if normalized_suffix == "k":
        numeric *= 1_000
    elif normalized_suffix == "m":
        numeric *= 1_000_000
    elif normalized_suffix == "b":
        numeric *= 1_000_000_000
    return numeric


def _resolve_yahoo_symbol(title: str, description: str) -> Optional[str]:
    yahoo_match = YAHOO_QUOTE_RE.search(description)
    if yahoo_match:
        return unquote(yahoo_match.group(1))

    pair_match = PAIR_RE.search(description)
    if pair_match:
        base, quote = pair_match.group(1).split("/", 1)
        base = base.strip().upper()
        quote = quote.strip().upper()
        if quote in {"USDT", "USD"}:
            return f"{base}-USD"

    haystack = f"{title} {description}".lower()
    for label, symbol in NAME_TO_YAHOO_SYMBOL.items():
        if label in haystack:
            return symbol
    return None


def _extract_market_chart_context(ctx: dict, market: Optional[Dict[str, Any]], range_name: str) -> Optional[Dict[str, Any]]:
    if not market:
        return None

    title = str(market.get("title") or "").strip()
    description = str(market.get("description") or "").strip()
    if not title and not description:
        return None

    title_match = PRICE_TARGET_RE.search(title)
    desc_match = PRICE_TARGET_RE.search(description)
    target_match = title_match or desc_match
    target_price = None
    if target_match:
        target_price = _parse_numeric_target(target_match.group(1), target_match.group(2))

    pair_match = PAIR_RE.search(description)
    pair_label = pair_match.group(1) if pair_match else None
    yahoo_symbol = _resolve_yahoo_symbol(title, description)
    is_up_down = "up or down" in title.lower() or "close price is greater than or equal to the open price" in description.lower()
    is_price_target = target_price is not None and (
        "price specified in the title" in description.lower()
        or "hit" in title.lower()
        or "reach" in title.lower()
    )

    if not yahoo_symbol or not (is_up_down or is_price_target):
        return None

    source_label = "Yahoo Finance" if "finance.yahoo.com/quote/" in description.lower() else "Underlying"
    if "binance" in description.lower():
        source_label = "Underlying proxy"

    yahoo_interval = "5m" if range_name in {"1h", "1d"} else "30m"
    yahoo_range = "1d" if range_name == "1h" else "5d"
    snapshot = ctx["get_yahoo_market_snapshot"](yahoo_symbol, interval=yahoo_interval, range_name=yahoo_range)
    if not snapshot or not snapshot.get("points"):
        return None

    return {
        "kind": "underlying-price",
        "sourceSymbol": yahoo_symbol,
        "sourceLabel": source_label,
        "pairLabel": pair_label,
        "targetPrice": target_price,
        "targetLabel": "Target" if is_price_target else "Price to beat",
        "referenceRule": "close >= open" if is_up_down else "hit threshold",
        "currentUnderlyingPrice": snapshot.get("price"),
        "underlyingChangePercent": snapshot.get("changePercent"),
        "points": snapshot.get("points") or [],
    }


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
    chart_context = _extract_market_chart_context(ctx, market, range_name)
    if chart_context:
        return {
            "marketId": market_id,
            "range": range_name,
            "interval": interval,
            "kind": chart_context.get("kind"),
            "sourceSymbol": chart_context.get("sourceSymbol"),
            "sourceLabel": chart_context.get("sourceLabel"),
            "pairLabel": chart_context.get("pairLabel"),
            "currentUnderlyingPrice": chart_context.get("currentUnderlyingPrice"),
            "underlyingChangePercent": chart_context.get("underlyingChangePercent"),
            "targetPrice": chart_context.get("targetPrice"),
            "targetLabel": chart_context.get("targetLabel"),
            "referenceRule": chart_context.get("referenceRule"),
            "points": chart_context.get("points"),
        }
    points = ctx["get_market_clob_price_series"](market, range_name=range_name, interval=interval)
    if not points:
        limit = 400
        if range_name == "7d":
            limit = 700
        points = ctx["get_trade_derived_market_price_series"](market_id, limit=limit)
    return {"marketId": market_id, "range": range_name, "interval": interval, "kind": "probability", "points": points}


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


def enrich_market_rows_with_runtime_prices(
    ctx: dict,
    rows: List[Dict[str, Any]],
    *,
    max_updates: int = 18,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    enriched_rows: List[Dict[str, Any]] = [dict(row) for row in rows]
    candidates: List[tuple[int, Dict[str, Any]]] = []
    for index, normalized in enumerate(enriched_rows):
        latest_trade_at = ctx["parse_iso_datetime"](normalized.get("last_trade_at") or normalized.get("latest_trade_at"))
        is_stale = latest_trade_at is None or (now - latest_trade_at) > timedelta(hours=6)
        needs_runtime_price = force_refresh or normalized.get("latest_price") in (None, "") or is_stale
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


def enrich_market_rows_with_24h_change(ctx: dict, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    market_ids = [int(row["id"]) for row in rows if row.get("id") is not None]
    if not market_ids:
        return rows
    trade_source = ctx["get_existing_trade_read_source"]()
    if trade_source is None:
        return rows

    placeholders = ", ".join("?" for _ in market_ids)
    threshold = ctx["utc_date_days_ago"](1)
    if ctx["_identifier_name"](trade_source) == ctx["TRADE_V2_CORE_TABLE"]:
        time_column = "block_time"
        order_columns = "block_time DESC, block_number DESC, log_index DESC"
        yes_price_expr = "CASE WHEN outcome_code = 2 THEN 1 - price ELSE price END"
    else:
        time_column = "timestamp"
        order_columns = "timestamp DESC, block_number DESC, log_index DESC"
        yes_price_expr = "CASE WHEN UPPER(COALESCE(outcome, '')) = 'NO' THEN 1 - price ELSE price END"

    price_rows = ctx["query_all"](
        f"""
        SELECT market_id, price
        FROM (
            SELECT
                market_id,
                {yes_price_expr} AS price,
                ROW_NUMBER() OVER (
                    PARTITION BY market_id
                    ORDER BY {order_columns}
                ) AS row_num
            FROM {trade_source}
            WHERE market_id IN ({placeholders}) AND {time_column} <= ?
        ) ranked_prices
        WHERE row_num = 1
        """,
        (*market_ids, threshold),
    )
    price_map = {int(row["market_id"]): row.get("price") for row in price_rows if row.get("market_id") is not None}
    enriched_rows: List[Dict[str, Any]] = []
    for row in rows:
        normalized = dict(row)
        market_id = normalized.get("id")
        if market_id is not None:
            normalized["price_24h_ago"] = price_map.get(int(market_id))
        enriched_rows.append(normalized)
    return enriched_rows


def _market_outcome_count(ctx: dict, row: Dict[str, Any]) -> int:
    token_ids = ctx["parse_json_list"](row.get("clob_token_ids"))
    if token_ids:
        return len(token_ids)
    yes_token = row.get("yes_token_id")
    no_token = row.get("no_token_id")
    return int(bool(yes_token)) + int(bool(no_token))


def _market_change(ctx: dict, current: Any, past: Any) -> Any:
    if current in (None, "") or past in (None, ""):
        return None
    try:
        delta = Decimal(str(current)) - Decimal(str(past))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return ctx["format_trade_decimal"](delta)


def _market_status_from_snapshot(row: Dict[str, Any], now_iso: str) -> str:
    if bool(row.get("has_settle")):
        return "Settled"
    if bool(row.get("has_propose")):
        return "Proposed"
    end_date = row.get("end_date")
    if end_date not in (None, "") and str(end_date) < now_iso:
        return "Closed"
    return "Active"


def _market_list_item(ctx: dict, row: Dict[str, Any]) -> Dict[str, Any]:
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
        "outcomeCount": _market_outcome_count(ctx, row),
        "volume24h": ctx["format_trade_decimal"](row.get("volume_24h")),
        "tradeCount24h": int(row.get("trade_count_24h") or 0),
        "change24h": row.get("change_24h") or _market_change(ctx, row.get("latest_price"), row.get("price_24h_ago")),
        "lastTradeAt": row.get("last_trade_at") or row.get("latest_trade_at"),
    }


def _active_market_candidate_select_sql(stats_alias: str) -> str:
    return f"""
            SELECT
                m.id,
                m.slug,
                m.condition_id,
                m.end_date,
                m.created_at,
                COALESCE(mss.has_settle, 0) AS has_settle,
                COALESCE(mss.has_propose, 0) AS has_propose,
                {stats_alias}.trade_count_24h,
                {stats_alias}.volume_24h,
                {stats_alias}.last_trade_at,
                {stats_alias}.latest_trade_at,
                {stats_alias}.price_24h_ago
            FROM markets m
            LEFT JOIN market_status_snapshot mss ON mss.market_id = m.id
            LEFT JOIN market_list_serving {stats_alias} ON {stats_alias}.market_id = m.id
            WHERE COALESCE(mss.has_settle, 0) = 0
              AND COALESCE(mss.has_propose, 0) = 0
              AND (m.end_date IS NULL OR m.end_date >= ?)
              AND {DEFAULT_ACTIVE_MARKET_EXCLUSION_SQL}
              AND {_default_active_market_activity_sql(stats_alias)}
        """


def _get_market_detail_rows_by_ids(ctx: dict, market_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    if not market_ids:
        return {}
    placeholders = ", ".join("?" for _ in market_ids)
    rows = ctx["query_all"](
        f"""
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
            m.clob_token_ids,
            m.end_date,
            m.created_at,
            COALESCE(mlp.latest_yes_price, mls.latest_price) AS latest_price,
            COALESCE(mls.latest_trade_at, mlp.latest_trade_at) AS latest_trade_at,
            mls.price_24h_ago
        FROM markets m
        LEFT JOIN market_list_serving mls ON mls.market_id = m.id
        LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
        WHERE m.id IN ({placeholders})
        """,
        market_ids,
    )
    return {
        int(row["id"]): row
        for row in rows
        if row.get("id") is not None
    }


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
        filters.append("(COALESCE(mss.has_settle, 0) = 0 AND COALESCE(mss.has_propose, 0) = 0 AND (m.end_date IS NULL OR m.end_date >= ?))")
        params.append(now_iso)
        if not query:
            filters.append(f"({DEFAULT_ACTIVE_MARKET_EXCLUSION_SQL})")
            filters.append(_default_active_market_activity_sql("mls"))
    elif status == "closed":
        filters.append("(COALESCE(mss.has_settle, 0) = 1 OR (COALESCE(mss.has_settle, 0) = 0 AND COALESCE(mss.has_propose, 0) = 0 AND m.end_date IS NOT NULL AND m.end_date < ?))")
        params.append(now_iso)
    if query:
        pattern = f"%{query}%"
        filters.append("(m.title LIKE ? OR m.slug LIKE ? OR m.condition_id LIKE ? OR m.question_id LIKE ?)")
        params.extend([pattern, pattern, pattern, pattern])

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    cache_key = json.dumps({"status": status, "query": query, "page": page, "pageSize": page_size}, sort_keys=True, ensure_ascii=True)

    if status == "active" and not query and page == 1:
        return get_active_markets_snapshot(ctx, page_size=page_size, include_runtime_prices=markets_runtime_prices_enabled())

    def build_payload() -> Dict[str, Any]:
        recent_14d_iso = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat().replace("+00:00", "Z")
        recent_30d_iso = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
        raw_limit = min(5000, max((offset + page_size + 1) * 6, 180))
        candidate_rows = ctx["query_all"](
            f"""
            SELECT
                m.id,
                m.slug,
                m.condition_id,
                m.end_date,
                m.created_at,
                COALESCE(mss.has_settle, 0) AS has_settle,
                COALESCE(mss.has_propose, 0) AS has_propose,
                mls.trade_count_24h,
                mls.volume_24h,
                mls.last_trade_at,
                mls.latest_trade_at,
                mls.price_24h_ago
            FROM markets m
            LEFT JOIN market_status_snapshot mss ON mss.market_id = m.id
            LEFT JOIN market_list_serving mls ON mls.market_id = m.id
            {where_clause}
            ORDER BY
                CASE
                    WHEN m.created_at >= ? THEN 0
                    WHEN m.created_at >= ? THEN 1
                    ELSE 2
                END ASC,
                m.created_at DESC,
                COALESCE(mls.trade_count_24h, 0) DESC,
                COALESCE(mls.volume_24h, 0) DESC,
                mls.last_trade_at DESC
            LIMIT ?
            """,
            [*params, recent_14d_iso, recent_30d_iso, raw_limit],
        )
        if status == "active":
            candidate_rows = _prefer_gamma_active_candidate_rows(ctx, candidate_rows, offset + page_size + 1)
        working_candidates = candidate_rows[offset: offset + max(page_size * 3, page_size + 1)]
        if not working_candidates and candidate_rows:
            working_candidates = candidate_rows[: max(page_size * 3, page_size + 1)]
        visible_market_ids = [int(row["id"]) for row in working_candidates if row.get("id") is not None]
        detail_rows = _get_market_detail_rows_by_ids(ctx, visible_market_ids)
        visible_rows: List[Dict[str, Any]] = []
        for candidate in working_candidates:
            market_id = candidate.get("id")
            if market_id is None:
                continue
            detail_row = detail_rows.get(int(market_id))
            if not detail_row:
                continue
            normalized = dict(detail_row)
            normalized.update(
                {
                    "trade_count_24h": candidate.get("trade_count_24h"),
                    "volume_24h": candidate.get("volume_24h"),
                    "last_trade_at": candidate.get("last_trade_at") or candidate.get("latest_trade_at"),
                    "price_24h_ago": candidate.get("price_24h_ago"),
                    "has_settle": candidate.get("has_settle"),
                    "has_propose": candidate.get("has_propose"),
                }
            )
            normalized["status"] = _market_status_from_snapshot(normalized, now_iso)
            visible_rows.append(normalized)
        max_runtime_updates = min(page_size, 40 if page_size >= 80 else (24 if page_size >= 40 else 16))
        visible_rows = enrich_market_rows_with_runtime_prices(
            ctx,
            visible_rows,
            max_updates=max_runtime_updates,
        )
        if status == "active":
            visible_rows = _prefer_tradeable_market_rows(visible_rows, page_size + 1)
        has_more = len(visible_rows) > page_size
        visible_rows = visible_rows[:page_size]
        return {
            "items": [_market_list_item(ctx, row) for row in visible_rows],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": offset + len(visible_rows) + (1 if has_more else 0),
                "totalPages": page + (1 if has_more else 0),
                "hasMore": has_more,
            },
        }

    return ctx["get_markets_payload_cached"](cache_key, build_payload)


def build_active_markets_payload(
    ctx: dict,
    page_size: int = 40,
    *,
    include_runtime_prices: bool = False,
    include_change_24h: bool = False,
) -> Dict[str, Any]:
    now_iso = ctx["utc_now_iso"]()
    raw_limit = max(page_size * 3, 180)
    volume_candidate_rows = ctx["query_all"](
        f"""
        {_active_market_candidate_select_sql("stats_24h")}
        ORDER BY COALESCE(stats_24h.volume_24h, 0) DESC, COALESCE(stats_24h.trade_count_24h, 0) DESC, stats_24h.last_trade_at DESC, m.created_at DESC
        LIMIT ?
        """,
        (now_iso, raw_limit),
    )
    recent_candidate_rows = ctx["query_all"](
        f"""
        {_active_market_candidate_select_sql("stats_24h")}
        ORDER BY m.created_at DESC, COALESCE(stats_24h.volume_24h, 0) DESC, COALESCE(stats_24h.trade_count_24h, 0) DESC
        LIMIT ?
        """,
        (now_iso, min(raw_limit, max(page_size * 2, 80))),
    )
    candidate_rows = _blend_recent_candidate_rows(volume_candidate_rows, recent_candidate_rows, page_size)
    candidate_stats_map = {
        int(row["id"]): {
            "trade_count_24h": row.get("trade_count_24h"),
            "volume_24h": row.get("volume_24h"),
            "last_trade_at": row.get("last_trade_at") or row.get("latest_trade_at"),
            "price_24h_ago": row.get("price_24h_ago"),
            "has_settle": row.get("has_settle"),
            "has_propose": row.get("has_propose"),
        }
        for row in candidate_rows
        if row.get("id") is not None
    }
    ordered_market_ids: List[int] = []
    for row in candidate_rows:
        market_id = row.get("id")
        if market_id is None:
            continue
        ordered_market_ids.append(int(market_id))
        if len(ordered_market_ids) >= max(page_size * 3, page_size):
            break
    detail_rows = _get_market_detail_rows_by_ids(ctx, ordered_market_ids)
    rows: List[Dict[str, Any]] = []
    for market_id in ordered_market_ids:
        detail_row = detail_rows.get(market_id)
        if not detail_row:
            continue
        normalized = dict(detail_row)
        normalized.update(candidate_stats_map.get(market_id, {}))
        normalized["status"] = _market_status_from_snapshot(normalized, now_iso)
        rows.append(normalized)
    if include_runtime_prices:
        rows = enrich_market_rows_with_runtime_prices(
            ctx,
            rows,
            max_updates=min(page_size, 24),
            force_refresh=False,
        )
    if include_change_24h:
        rows = enrich_market_rows_with_24h_change(ctx, rows)
    rows = rows[:page_size]
    return {
        "items": [_market_list_item(ctx, row) for row in rows],
        "pagination": {"page": 1, "pageSize": page_size, "total": len(rows), "totalPages": 1, "hasMore": False},
    }


def get_active_markets_snapshot(ctx: dict, page_size: int = 40, *, include_runtime_prices: bool = False) -> Dict[str, Any]:
    cache_key = json.dumps(
        {
            "page": 1,
            "pageSize": page_size,
            "status": "active",
            "includeRuntimePrices": include_runtime_prices,
            "includeChange24h": include_runtime_prices,
            "v": 9,
        },
        sort_keys=True,
        ensure_ascii=True,
    )
    exact_payload = ctx["SNAPSHOT_STORE"].get(ACTIVE_MARKETS_SNAPSHOT_NAMESPACE, cache_key)
    if exact_payload is not None:
        ctx["set_cached_json"](ACTIVE_MARKETS_SNAPSHOT_NAMESPACE, cache_key, exact_payload, 60)
        return exact_payload

    if markets_latest_snapshot_fallback_enabled():
        latest_payload = ctx["SNAPSHOT_STORE"].get_latest_stale(ACTIVE_MARKETS_SNAPSHOT_NAMESPACE, exclude_cache_key=cache_key)
        fallback_payload = _trim_active_markets_payload(ctx, latest_payload, page_size)
        if fallback_payload is not None:
            ctx["app"].logger.info(
                "markets-active latest-snapshot-fallback page_size=%s include_runtime_prices=%s",
                page_size,
                include_runtime_prices,
            )
            ctx["SNAPSHOT_STORE"].set(ACTIVE_MARKETS_SNAPSHOT_NAMESPACE, cache_key, fallback_payload, 60)
            ctx["set_cached_json"](ACTIVE_MARKETS_SNAPSHOT_NAMESPACE, cache_key, fallback_payload, 60)
            return fallback_payload

    return ctx["get_snapshot_payload"](
        ACTIVE_MARKETS_SNAPSHOT_NAMESPACE,
        cache_key,
        lambda: build_active_markets_payload(
            ctx,
            page_size=page_size,
            include_runtime_prices=include_runtime_prices,
            include_change_24h=include_runtime_prices,
        ),
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
