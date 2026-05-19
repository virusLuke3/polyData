from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

MARKET_GROUPS_LIST_NAMESPACE = "snapshot:market-groups:list"
MARKET_GROUPS_DETAIL_NAMESPACE = "snapshot:market-groups:detail"
MARKET_GROUPS_CHART_NAMESPACE = "snapshot:market-groups:chart"
MARKET_GROUPS_LIST_TTL_SECONDS = 120
MARKET_GROUPS_DETAIL_TTL_SECONDS = 180

CHART_RANGE_INTERVALS: Dict[str, str] = {
    "1h": "5m",
    "6h": "5m",
    "1d": "15m",
    "1w": "1h",
    "1m": "6h",
    "all": "1d",
}

CHART_RANGE_TTLS: Dict[str, int] = {
    "1h": 180,
    "6h": 240,
    "1d": 600,
    "1w": 900,
    "1m": 1200,
    "all": 1800,
}

SERIES_PALETTE = [
    "#ff5b57",
    "#d8b04b",
    "#7cb6ff",
    "#4469d8",
    "#42c37b",
    "#c48bff",
]


NOISY_MARKET_TERMS = (
    "hide-from-new",
    "recurring",
    "onchain-registry",
    "updown-5m",
    "updown-15m",
)

GENERIC_TAGS = {
    "all",
    "featured",
    "hide-from-new",
    "recurring",
    "onchain-registry",
    "up-or-down",
    "crypto-prices",
    "5m",
    "15m",
}


def _as_list(value: Any) -> List[Any]:
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
            parsed = json.loads(text)
            return parsed if isinstance(parsed, list) else [parsed]
        except Exception:
            return [item.strip() for item in text.split(",") if item.strip()]
    return [value]


def _float_value(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _parse_timestamp(value: Any) -> float:
    if not value:
        return 0.0
    text = str(value).strip().replace("Z", "+00:00")
    if not text:
        return 0.0
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _event_tags(event: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    for item in _as_list(event.get("tags")):
        if isinstance(item, dict):
            label = item.get("label") or item.get("name") or item.get("slug")
        else:
            label = item
        if label not in (None, ""):
            tags.append(str(label))
    return tags


def _slugify_token(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _normalized_event_tags(event: Dict[str, Any]) -> List[str]:
    normalized: List[str] = []
    for tag in _event_tags(event):
        slug = _slugify_token(tag)
        if slug:
            normalized.append(slug)
    return normalized


def _normalized_text(*parts: Any) -> str:
    return " ".join(str(part or "").lower() for part in parts)


def _is_noisy_event(event: Dict[str, Any]) -> bool:
    text = _normalized_text(event.get("title"), event.get("slug"), *_normalized_event_tags(event))
    if " up or down - " in text:
        return True
    return any(term in text for term in NOISY_MARKET_TERMS)


def _is_event_ended(event: Dict[str, Any], now_iso: str) -> bool:
    if event.get("closed") is True or event.get("active") is False:
        return True
    end_date = event.get("endDate") or event.get("end_date")
    if not end_date:
        return False
    return _parse_timestamp(end_date) > 0 and _parse_timestamp(end_date) < _parse_timestamp(now_iso)


def _market_active(market: Dict[str, Any]) -> bool:
    if market.get("closed") is True:
        return False
    if market.get("active") is False:
        return False
    if market.get("acceptingOrders") is False:
        return False
    return True


def _market_prices(market: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    prices = _as_list(market.get("outcomePrices") or market.get("outcome_prices"))
    yes_price = _float_value(prices[0]) if prices else None
    no_price = _float_value(prices[1]) if len(prices) > 1 else None
    if no_price is None and yes_price is not None:
        no_price = max(0.0, min(1.0, 1.0 - yes_price))
    return yes_price, no_price


def _normalize_outcome_key(label: Any, fallback: Any = "") -> str:
    source = str(label or fallback or "").strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", source).strip("-")
    return cleaned or "outcome"


def _terminal_event(active_markets: List[Dict[str, Any]]) -> bool:
    prices = [
        yes
        for yes, _no in (_market_prices(market) for market in active_markets)
        if yes is not None
    ]
    if not prices:
        return False
    return all(price <= 0.01 or price >= 0.99 for price in prices)


def _category_for_event(event: Dict[str, Any]) -> str:
    tags = _normalized_event_tags(event)
    raw_category = str(event.get("category") or event.get("categorySlug") or event.get("category_slug") or "").strip()
    text = _normalized_text(event.get("title"), event.get("slug"), raw_category, *tags)
    if any(term in text for term in ("bitcoin", "ethereum", "solana", "xrp", "dogecoin", "crypto", "btc", "eth")):
        return "crypto"
    if any(term in text for term in ("election", "president", "senate", "congress", "politic")):
        return "politics"
    if any(term in text for term in ("nba", "nfl", "mlb", "nhl", "soccer", "tennis", "sports")):
        return "sports"
    if any(term in text for term in ("fed", "inflation", "rate", "economy", "finance", "macro")):
        return "macro"
    if any(term in text for term in ("ai", "openai", "tech")):
        return "tech"
    for tag in tags:
        if tag and tag not in GENERIC_TAGS:
            return tag
    return raw_category.lower() or "market"


def _label_for_market(event_title: str, market: Dict[str, Any]) -> str:
    label = str(market.get("groupItemTitle") or market.get("group_item_title") or "").strip()
    if label:
        return label
    question = str(market.get("question") or market.get("title") or "").strip()
    if event_title and question.startswith(event_title):
        candidate = question[len(event_title):].strip(" -:·")
        if candidate:
            return candidate
    match = re.match(r"Will\s+(.+?)\s+win\b", question, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return question or str(market.get("slug") or market.get("id") or "Outcome")


def _market_identity(market: Dict[str, Any]) -> Tuple[str, str, str]:
    condition_id = str(market.get("conditionId") or market.get("condition_id") or "").strip().lower()
    slug = str(market.get("slug") or market.get("market_slug") or "").strip().lower()
    token_ids = _market_token_ids(market)
    yes_token_id = token_ids[0] if token_ids else ""
    return condition_id, slug, yes_token_id


def _market_token_ids(market: Dict[str, Any]) -> List[str]:
    return [str(item).strip() for item in _as_list(market.get("clobTokenIds") or market.get("clob_token_ids")) if str(item).strip()]


def _chunk(values: Iterable[str], size: int = 450) -> Iterable[List[str]]:
    batch: List[str] = []
    for value in values:
        if not value:
            continue
        batch.append(value)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _query_market_rows(ctx: dict, column_expr: str, values: Iterable[str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    unique_values = sorted({str(value).strip().lower() for value in values if str(value).strip()})
    for batch in _chunk(unique_values):
        placeholders = ",".join("?" for _ in batch)
        rows.extend(
            ctx["query_all"](
                f"""
                SELECT
                    m.id,
                    m.slug,
                    m.title,
                    LOWER(COALESCE(m.condition_id, '')) AS condition_key,
                    LOWER(COALESCE(m.slug, '')) AS slug_key,
                    COALESCE(m.yes_token_id, '') AS yes_token_id,
                    m.gamma_market_id,
                    COALESCE(mlp.latest_yes_price, mls.latest_price) AS latest_yes_price,
                    mlp.latest_no_price,
                    mls.volume_24h,
                    mls.trade_count_24h,
                    COALESCE(mls.last_trade_at, mls.latest_trade_at) AS last_trade_at,
                    mls.price_24h_ago
                FROM markets m
                LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
                LEFT JOIN market_list_serving mls ON mls.market_id = m.id
                WHERE {column_expr} IN ({placeholders})
                """,
                batch,
            )
        )
    return rows


def _local_market_lookup(
    ctx: dict,
    events: List[Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    condition_ids: set[str] = set()
    gamma_market_ids: set[str] = set()
    slugs: set[str] = set()
    yes_token_ids: set[str] = set()
    for event in events:
        for market in event.get("markets") or []:
            if not isinstance(market, dict):
                continue
            condition_id, slug, yes_token_id = _market_identity(market)
            gamma_market_id = str(market.get("id") or market.get("gamma_market_id") or "").strip()
            if condition_id:
                condition_ids.add(condition_id)
            if gamma_market_id:
                gamma_market_ids.add(gamma_market_id)
            if slug:
                slugs.add(slug)
            if yes_token_id:
                yes_token_ids.add(yes_token_id)

    by_condition: Dict[str, Dict[str, Any]] = {}
    by_gamma: Dict[str, Dict[str, Any]] = {}
    by_slug: Dict[str, Dict[str, Any]] = {}
    by_yes_token: Dict[str, Dict[str, Any]] = {}
    for row in _query_market_rows(ctx, "m.condition_id", condition_ids):
        by_condition.setdefault(str(row.get("condition_key") or ""), row)
    for row in _query_market_rows(ctx, "m.gamma_market_id", gamma_market_ids):
        by_gamma.setdefault(str(row.get("gamma_market_id") or ""), row)
    for row in _query_market_rows(ctx, "m.slug", slugs):
        by_slug.setdefault(str(row.get("slug_key") or ""), row)
    for row in _query_market_rows(ctx, "m.yes_token_id", yes_token_ids):
        by_yes_token.setdefault(str(row.get("yes_token_id") or ""), row)
    return by_condition, by_gamma, by_slug, by_yes_token


def _fetch_gamma_events(
    ctx: dict,
    *,
    max_pages: int = 10,
    target_events: int = 240,
    order: str = "volume24hr",
    ttl_seconds: int = 45,
) -> List[Dict[str, Any]]:
    cache_key = json.dumps(
        {
            "kind": "market-groups-gamma-events",
            "maxPages": int(max_pages),
            "order": str(order or "volume24hr"),
            "targetEvents": int(target_events),
            "v": 2,
        },
        sort_keys=True,
    )
    cached = ctx["get_cached_runtime_payload"]("market-groups", cache_key)
    if isinstance(cached, list):
        return cached

    events: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()
    limit = 100
    for page in range(max(1, int(max_pages))):
        payload = ctx["http_json_get"](
            f"{ctx['SETTINGS'].gamma_api_base.rstrip('/')}/events",
            params={
                "active": "true",
                "closed": "false",
                "limit": limit,
                "offset": page * limit,
                "order": order,
                "ascending": "false",
            },
            timeout=12,
            headers={"Accept": "application/json", "User-Agent": "polydata-runtime/1.0"},
        )
        page_events = payload if isinstance(payload, list) else ((payload or {}).get("events") or (payload or {}).get("data") or [])
        if not isinstance(page_events, list) or not page_events:
            break
        for event in page_events:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("id") or event.get("slug") or "").strip()
            if not event_id or event_id in seen_ids:
                continue
            seen_ids.add(event_id)
            events.append(event)
            if len(events) >= target_events:
                break
        if len(events) >= target_events:
            break
        if len(page_events) < limit:
            break
    return ctx["set_cached_runtime_payload"]("market-groups", cache_key, events, ttl_seconds=ttl_seconds)


def _extract_events(payload: Any) -> List[Dict[str, Any]]:
    events = payload if isinstance(payload, list) else ((payload or {}).get("events") or (payload or {}).get("data") or [])
    if not isinstance(events, list):
        return []
    return [event for event in events if isinstance(event, dict)]


def _fetch_gamma_event_by_id(ctx: dict, event_id: str) -> Optional[Dict[str, Any]]:
    identifier = str(event_id or "").strip()
    if not identifier:
        return None
    for params in ({"id": identifier}, {"slug": identifier}):
        try:
            payload = ctx["http_json_get"](
                f"{ctx['SETTINGS'].gamma_api_base.rstrip('/')}/events",
                params=params,
                timeout=12,
                headers={"Accept": "application/json", "User-Agent": "polydata-runtime/1.0"},
            )
        except Exception:
            continue
        for event in _extract_events(payload):
            if str(event.get("id") or "").strip() == identifier or str(event.get("slug") or "").strip() == identifier:
                return event
        if len(_extract_events(payload)) == 1:
            return _extract_events(payload)[0]

    for event in _fetch_gamma_events(ctx, target_events=300):
        if str(event.get("id") or "").strip() == identifier or str(event.get("slug") or "").strip() == identifier:
            return event
    return None


def _normalize_group(ctx: dict, event: Dict[str, Any], lookups: Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    now_iso = ctx["utc_now_iso"]()
    if _is_event_ended(event, now_iso) or _is_noisy_event(event):
        return None
    markets = [market for market in (event.get("markets") or []) if isinstance(market, dict) and _market_active(market)]
    if not markets or _terminal_event(markets):
        return None

    by_condition, by_gamma, by_slug, by_yes_token = lookups
    event_title = str(event.get("title") or "").strip() or "Untitled event"
    outcomes: List[Dict[str, Any]] = []
    for market in markets:
        condition_id, slug, yes_token_id = _market_identity(market)
        gamma_market_id = str(market.get("id") or market.get("gamma_market_id") or "").strip()
        token_ids = _market_token_ids(market)
        no_token_id = token_ids[1] if len(token_ids) > 1 else ""
        local = by_condition.get(condition_id) or by_gamma.get(gamma_market_id) or by_slug.get(slug) or by_yes_token.get(yes_token_id) or {}
        gamma_yes, gamma_no = _market_prices(market)
        local_yes = _float_value(local.get("latest_yes_price"))
        yes_price = local_yes if local_yes is not None else gamma_yes
        no_price = _float_value(local.get("latest_no_price"))
        if no_price is None:
            no_price = gamma_no
        change_24h = _float_value(market.get("oneDayPriceChange") or market.get("one_day_price_change"))
        if change_24h is None and yes_price is not None:
            price_24h_ago = _float_value(local.get("price_24h_ago"))
            if price_24h_ago is not None:
                change_24h = yes_price - price_24h_ago
        volume_24h = _float_value(local.get("volume_24h"))
        if volume_24h is None:
            volume_24h = _float_value(market.get("volume24hr") or market.get("volume_24hr") or market.get("volume24h"))
        label = _label_for_market(event_title, market)
        outcomes.append(
            {
                "outcomeKey": _normalize_outcome_key(label, market.get("id")),
                "marketId": local.get("id"),
                "localMarketId": local.get("id"),
                "gammaMarketId": market.get("id"),
                "label": label,
                "title": market.get("question") or market.get("title") or local.get("title") or event_title,
                "yesPrice": yes_price,
                "noPrice": no_price,
                "change24h": change_24h,
                "volume24h": volume_24h,
                "tradeCount24h": local.get("trade_count_24h"),
                "lastTradeAt": local.get("last_trade_at"),
                "conditionId": condition_id or None,
                "slug": slug or market.get("slug") or local.get("slug"),
                "yesTokenId": yes_token_id or None,
                "noTokenId": no_token_id or None,
            }
        )

    top_outcomes = sorted(
        [outcome for outcome in outcomes if outcome.get("yesPrice") is not None],
        key=lambda outcome: float(outcome.get("yesPrice") or 0),
        reverse=True,
    )
    last_activity_at = None
    last_activity_ts = 0.0
    for outcome in outcomes:
        candidate = outcome.get("lastTradeAt")
        candidate_ts = _parse_timestamp(candidate)
        if candidate_ts > last_activity_ts:
            last_activity_ts = candidate_ts
            last_activity_at = candidate
    def _default_outcome_score(outcome: Dict[str, Any]) -> Tuple[float, float, float]:
        price = _float_value(outcome.get("yesPrice"))
        volume = _float_value(outcome.get("volume24h")) or 0.0
        trades = _float_value(outcome.get("tradeCount24h")) or 0.0
        label = str(outcome.get("label") or "").lower()
        score = 0.0
        if outcome.get("marketId") is not None:
            score += 12.0
        if outcome.get("yesTokenId"):
            score += 8.0
        if volume > 0:
            score += min(40.0, volume ** 0.25)
        if trades > 0:
            score += min(20.0, trades)
        if price is not None:
            if 0.02 < price < 0.98:
                score += 40.0
            if price <= 0.01 or price >= 0.99:
                score -= 60.0
        if "completed match" in label or label.strip() in {"completed", "match completed"}:
            score -= 30.0
        return (score, volume, trades)

    default_candidates = [outcome for outcome in outcomes if outcome.get("marketId") is not None or outcome.get("yesTokenId")]
    default_outcome = max(default_candidates, key=_default_outcome_score, default=None)
    if default_outcome is None and top_outcomes:
        default_outcome = top_outcomes[0]
    if default_outcome is None and outcomes:
        default_outcome = outcomes[0]
    event_volume_24h = _float_value(event.get("volume24hr") or event.get("volume_24hr") or event.get("volume24h"))
    if event_volume_24h is None:
        outcome_volumes = [_float_value(outcome.get("volume24h")) for outcome in outcomes]
        summed_volume = sum(value for value in outcome_volumes if value is not None)
        event_volume_24h = summed_volume if summed_volume > 0 else None
    event_trade_count_24h = sum(
        int(float(value))
        for value in (_float_value(outcome.get("tradeCount24h")) for outcome in outcomes)
        if value is not None and value > 0
    ) or None

    return {
        "groupId": f"event:{event.get('id') or event.get('slug')}",
        "eventId": event.get("id"),
        "title": event_title,
        "slug": event.get("slug"),
        "category": _category_for_event(event),
        "tags": _event_tags(event),
        "createdAt": event.get("startDate") or event.get("createdAt") or event.get("created_at"),
        "endDate": event.get("endDate") or event.get("end_date"),
        "volume24h": event_volume_24h,
        "tradeCount24h": event_trade_count_24h,
        "outcomeCount": len(outcomes),
        "lastActivityAt": last_activity_at,
        "defaultOutcomeKey": default_outcome.get("outcomeKey") if default_outcome else None,
        "defaultMarketId": default_outcome.get("marketId") if default_outcome else None,
        "outcomes": outcomes,
        "topOutcomes": [
            {
                "outcomeKey": outcome.get("outcomeKey"),
                "label": outcome.get("label"),
                "yesPrice": outcome.get("yesPrice"),
                "noPrice": outcome.get("noPrice"),
                "change24h": outcome.get("change24h"),
                "volume24h": outcome.get("volume24h"),
                "tradeCount24h": outcome.get("tradeCount24h"),
                "marketId": outcome.get("marketId"),
                "localMarketId": outcome.get("localMarketId"),
                "gammaMarketId": outcome.get("gammaMarketId"),
                "conditionId": outcome.get("conditionId"),
                "slug": outcome.get("slug"),
                "yesTokenId": outcome.get("yesTokenId"),
                "noTokenId": outcome.get("noTokenId"),
            }
            for outcome in top_outcomes[:5]
        ],
    }


def _matches_query(group: Dict[str, Any], query: str) -> bool:
    if not query:
        return True
    haystack = " ".join(
        [
            str(group.get("title") or ""),
            str(group.get("slug") or ""),
            str(group.get("category") or ""),
            " ".join(str(tag) for tag in group.get("tags") or []),
            " ".join(str(outcome.get("label") or "") for outcome in group.get("outcomes") or []),
        ]
    ).lower()
    return query.lower() in haystack


def _event_identity(event: Dict[str, Any]) -> str:
    return str(event.get("id") or event.get("slug") or "").strip()


def _merge_unique_events(*event_lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for events in event_lists:
        for event in events:
            identity = _event_identity(event)
            if not identity or identity in seen:
                continue
            seen.add(identity)
            merged.append(event)
    return merged


def _group_created_ts(group: Dict[str, Any]) -> float:
    return _parse_timestamp(group.get("createdAt"))


def _group_last_activity_ts(group: Dict[str, Any]) -> float:
    return _parse_timestamp(group.get("lastActivityAt")) or _group_created_ts(group)


def _group_has_ready_signal(group: Dict[str, Any]) -> bool:
    if (_float_value(group.get("volume24h")) or 0.0) > 0:
        return True
    if (_float_value(group.get("tradeCount24h")) or 0.0) > 0:
        return True
    return any(
        (_float_value((outcome or {}).get("volume24h")) or 0.0) > 0
        or (_float_value((outcome or {}).get("tradeCount24h")) or 0.0) > 0
        for outcome in (group.get("outcomes") or [])
    )


def _group_has_live_price_signal(group: Dict[str, Any]) -> bool:
    for outcome in group.get("outcomes") or []:
        price = _float_value((outcome or {}).get("yesPrice"))
        if price is None:
            continue
        if 0.01 < price < 0.99 and (outcome or {}).get("yesTokenId"):
            return True
    return False


def _active_group_sort_key(group: Dict[str, Any], *, now_ts: float) -> Tuple[int, int, float, float, float, float]:
    created_ts = _group_created_ts(group)
    raw_last_activity_ts = _parse_timestamp(group.get("lastActivityAt"))
    last_activity_ts = raw_last_activity_ts or created_ts
    volume = _float_value(group.get("volume24h")) or 0.0
    trade_count = _float_value(group.get("tradeCount24h")) or 0.0
    ready_signal = _group_has_ready_signal(group)
    live_price_signal = _group_has_live_price_signal(group)
    multi_penalty = 0 if int(group.get("outcomeCount") or 0) > 2 else 1
    recent_threshold = now_ts - (14 * 86400)
    fresh_threshold = now_ts - (12 * 3600)
    if volume > 0 and last_activity_ts >= recent_threshold:
        bucket = 0
        recency = last_activity_ts
    elif volume > 0:
        bucket = 1
        recency = last_activity_ts
    elif trade_count > 0 and ready_signal:
        bucket = 2
        recency = last_activity_ts
    elif live_price_signal and created_ts >= fresh_threshold:
        bucket = 3
        recency = created_ts
    else:
        bucket = 4
        recency = max(created_ts, last_activity_ts)
    return (bucket, multi_penalty, -volume, -trade_count, -recency, -created_ts)


def _empty_market_groups_payload(ctx: dict, *, page: int, page_size: int, status: str = "degraded") -> Dict[str, Any]:
    return {
        "items": [],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": 0,
            "totalPages": 1,
            "hasMore": False,
        },
        "generatedAt": ctx["utc_now_iso"](),
        "status": status,
    }


def get_market_groups_payload(
    ctx: dict,
    *,
    query: str = "",
    page: int = 1,
    page_size: int = 80,
    sort: str = "active",
) -> Dict[str, Any]:
    page = max(1, int(page))
    page_size = min(200, max(1, int(page_size)))
    sort = str(sort or "active").strip().lower()
    if sort not in {"active", "new", "volume"}:
        sort = "active"
    query = str(query or "").strip()

    cache_key = json.dumps({"q": query, "page": page, "pageSize": page_size, "sort": sort, "v": 7}, sort_keys=True)

    def _builder() -> Dict[str, Any]:
        fetch_target = max(100, min(1000, (page * page_size * 3)))
        if sort == "active":
            recent_events: List[Dict[str, Any]] = []
            volume_events: List[Dict[str, Any]] = []
            try:
                recent_events = _fetch_gamma_events(ctx, target_events=fetch_target, order="startDate")
            except Exception:
                ctx["app"].logger.exception("market-group list recent gamma fetch failed page=%s page_size=%s", page, page_size)
            try:
                volume_events = _fetch_gamma_events(ctx, target_events=fetch_target, order="volume24hr")
            except Exception:
                ctx["app"].logger.exception("market-group list volume gamma fetch failed page=%s page_size=%s", page, page_size)
            events = _merge_unique_events(recent_events, volume_events)
            if not events:
                return _empty_market_groups_payload(ctx, page=page, page_size=page_size)
        else:
            try:
                gamma_order = "startDate" if sort == "new" else "volume24hr"
                events = _fetch_gamma_events(ctx, target_events=fetch_target, order=gamma_order)
            except Exception:
                ctx["app"].logger.exception("market-group list gamma fetch failed sort=%s page=%s page_size=%s", sort, page, page_size)
                return _empty_market_groups_payload(ctx, page=page, page_size=page_size)
        now_iso = ctx["utc_now_iso"]()
        now_ts = _parse_timestamp(now_iso)
        candidate_events = [
            event
            for event in events
            if isinstance(event, dict)
            and not _is_event_ended(event, now_iso)
            and not _is_noisy_event(event)
            and (
                not query
                or _matches_query(
                    {
                        "title": event.get("title"),
                        "slug": event.get("slug"),
                        "category": _category_for_event(event),
                        "tags": _event_tags(event),
                        "outcomes": [
                            {"label": _label_for_market(str(event.get("title") or ""), market)}
                            for market in (event.get("markets") or [])
                            if isinstance(market, dict)
                        ],
                    },
                    query,
                )
            )
        ]

        if sort == "new":
            candidate_events.sort(
                key=lambda event: _parse_timestamp(event.get("startDate") or event.get("createdAt") or event.get("created_at")),
                reverse=True,
            )
        elif sort == "volume":
            candidate_events.sort(
                key=lambda event: _float_value(event.get("volume24hr") or event.get("volume_24hr") or event.get("volume24h")) or 0.0,
                reverse=True,
            )

        offset = (page - 1) * page_size
        lookup_events = candidate_events[: offset + max(page_size * 3, page_size + 20)]
        lookups = _local_market_lookup(ctx, lookup_events)
        groups = [
            group
            for event in lookup_events
            for group in [_normalize_group(ctx, event, lookups)]
            if group is not None and _matches_query(group, query)
        ]
        if sort == "active":
            groups.sort(key=lambda group: _active_group_sort_key(group, now_ts=now_ts))

        visible = groups[offset: offset + page_size]
        has_more = len(groups) > offset + page_size or len(candidate_events) > len(lookup_events)
        return {
            "items": visible,
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": max(len(groups), len(candidate_events)),
                "totalPages": max(1, (max(len(groups), len(candidate_events)) + page_size - 1) // page_size),
                "hasMore": has_more,
            },
            "generatedAt": ctx["utc_now_iso"](),
        }

    if "get_snapshot_payload" in ctx:
        return ctx["get_snapshot_payload"](
            MARKET_GROUPS_LIST_NAMESPACE,
            cache_key,
            _builder,
            ttl_seconds=MARKET_GROUPS_LIST_TTL_SECONDS,
        )
    return _builder()


def get_market_group_detail_payload(ctx: dict, event_id: str) -> Optional[Dict[str, Any]]:
    identifier = str(event_id or "").strip()
    if not identifier:
        return None
    cache_key = json.dumps({"eventId": identifier, "v": 4}, sort_keys=True)

    def _builder() -> Optional[Dict[str, Any]]:
        try:
            event = _fetch_gamma_event_by_id(ctx, identifier)
        except Exception:
            ctx["app"].logger.exception("market-group detail gamma fetch failed event_id=%s", identifier)
            return {
                "groupId": f"event:{identifier}",
                "eventId": identifier,
                "title": "Market group unavailable",
                "outcomes": [],
                "topOutcomes": [],
                "generatedAt": ctx["utc_now_iso"](),
                "status": "degraded",
            }
        if not isinstance(event, dict):
            return None
        lookups = _local_market_lookup(ctx, [event])
        group = _normalize_group(ctx, event, lookups)
        if group is None:
            return None
        group["generatedAt"] = ctx["utc_now_iso"]()
        group["status"] = "ok"
        return group

    if "get_snapshot_payload" in ctx:
        payload = ctx["get_snapshot_payload"](
            MARKET_GROUPS_DETAIL_NAMESPACE,
            cache_key,
            _builder,
            ttl_seconds=MARKET_GROUPS_DETAIL_TTL_SECONDS,
        )
        return payload if isinstance(payload, dict) else None
    payload = _builder()
    return payload if isinstance(payload, dict) else None


def get_market_group_chart_payload(ctx: dict, event_id: str, *, range_name: str = "1d") -> Optional[Dict[str, Any]]:
    identifier = str(event_id or "").strip()
    normalized_range = str(range_name or "1d").strip().lower()
    if normalized_range not in CHART_RANGE_INTERVALS:
        normalized_range = "1d"
    cache_key = json.dumps({"eventId": identifier, "range": normalized_range, "v": 6}, sort_keys=True)

    def _builder() -> Optional[Dict[str, Any]]:
        detail = get_market_group_detail_payload(ctx, identifier)
        if not isinstance(detail, dict):
            return None
        if detail.get("status") == "degraded":
            return {
                "eventId": detail.get("eventId"),
                "groupId": detail.get("groupId"),
                "title": detail.get("title"),
                "defaultOutcomeKey": detail.get("defaultOutcomeKey"),
                "range": normalized_range,
                "interval": CHART_RANGE_INTERVALS.get(normalized_range, "15m"),
                "series": [],
                "generatedAt": ctx["utc_now_iso"](),
                "status": "degraded",
            }
        sorted_outcomes = sorted(
            [outcome for outcome in (detail.get("outcomes") or []) if isinstance(outcome, dict)],
            key=lambda outcome: float(outcome.get("yesPrice") or 0.0),
            reverse=True,
        )
        interval = CHART_RANGE_INTERVALS.get(normalized_range, "15m")
        series = []
        for index, outcome in enumerate(sorted_outcomes):
            yes_token_id = str(outcome.get("yesTokenId") or "").strip()
            if not yes_token_id:
                continue
            pseudo_market = {
                "id": outcome.get("marketId") or f"{identifier}:{outcome.get('outcomeKey')}",
                "yes_token_id": yes_token_id,
            }
            points = ctx["get_market_clob_price_series"](pseudo_market, range_name=normalized_range, interval=interval)
            normalized_points = []
            for point in points or []:
                yes_price = _float_value(point.get("yesPrice"))
                timestamp = point.get("timestamp")
                if yes_price is None or not timestamp:
                    continue
                normalized_points.append({"timestamp": timestamp, "price": yes_price})
            if len(normalized_points) < 2:
                continue
            series.append(
                {
                    "outcomeKey": outcome.get("outcomeKey"),
                    "label": outcome.get("label"),
                    "marketId": outcome.get("marketId"),
                    "color": SERIES_PALETTE[index % len(SERIES_PALETTE)],
                    "points": normalized_points,
                }
            )

        return {
            "eventId": detail.get("eventId"),
            "groupId": detail.get("groupId"),
            "title": detail.get("title"),
            "defaultOutcomeKey": detail.get("defaultOutcomeKey"),
            "range": normalized_range,
            "interval": interval,
            "series": series,
            "historyStatus": "ok" if series else "pending",
            "generatedAt": ctx["utc_now_iso"](),
        }

    if "get_snapshot_payload" in ctx:
        payload = ctx["get_snapshot_payload"](
            MARKET_GROUPS_CHART_NAMESPACE,
            cache_key,
            _builder,
            ttl_seconds=CHART_RANGE_TTLS.get(normalized_range, 60),
        )
        return payload if isinstance(payload, dict) else None
    payload = _builder()
    return payload if isinstance(payload, dict) else None
