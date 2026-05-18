from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

from weather.cities import load_weather_cities
from weather.temperature_bins import parse_temperature_bin
from weather.weather_codes import describe_weather_code


GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE = "snapshot:weather:global-map"
GLOBAL_WEATHER_MAP_CACHE_KEY = "panel-v1"
DEFAULT_ITEM_LIMIT = 34

WEATHER_MARKET_TERMS = ("temperature", "highest temperature", "high temperature", "weather")
GAMMA_QUERY_TIMEOUT_SECONDS = 6
GAMMA_QUERIES_PER_CITY = 2
GAMMA_QUERY_PAUSE_SECONDS = 0.03

_LIVE_REFRESH_LOCK = threading.Lock()
_LIVE_REFRESHING: set[str] = set()


def _utc_now_iso(ctx: dict) -> str:
    now = ctx.get("utc_now_iso")
    return now() if callable(now) else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _float(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


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
            return [part.strip() for part in text.split(",") if part.strip()]
    return [value]


def _c_to_unit(value: Any, unit: str) -> Optional[float]:
    number = _float(value)
    if number is None:
        return None
    return round((number * 9 / 5) + 32, 1) if str(unit).upper() == "F" else round(number, 1)


def _parse_ts(value: Any) -> float:
    if not value:
        return 0.0
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _date_labels(ctx: dict, days: int) -> List[Dict[str, str]]:
    now = datetime.fromisoformat(_utc_now_iso(ctx).replace("Z", "+00:00"))
    labels: List[Dict[str, str]] = []
    for offset in range(max(1, int(days or 4))):
        day = now + timedelta(days=offset)
        labels.append({"iso": day.date().isoformat(), "month": day.strftime("%B").lower(), "monthShort": day.strftime("%b").lower(), "day": str(day.day), "year": str(day.year)})
    return labels


def _normalize_text(*parts: Any) -> str:
    return " ".join(str(part or "").lower() for part in parts)


def _row_to_dict(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "as_dict"):
        return row.as_dict()
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "keys"):
        return {key: row[key] for key in row.keys()}
    return {}


def _json_safe_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return value


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value or "").strip().lower()
    return text in {"1", "true", "t", "yes", "y", "closed", "resolved"}


def _slugify(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return re.sub(r"-+", "-", text)


def _matches_alias(text: str, city: Dict[str, Any]) -> bool:
    aliases = [city.get("city"), *list(city.get("polymarket_aliases") or [])]
    for alias in aliases:
        normalized = str(alias or "").strip().lower()
        if normalized and re.search(r"(?<![a-z0-9])" + re.escape(normalized).replace(r"\ ", r"\s+") + r"(?![a-z0-9])", text):
            return True
    return False


def _matches_weather_market(text: str) -> bool:
    return any(term in text for term in WEATHER_MARKET_TERMS)


def _matches_high_temperature_market(text: str) -> bool:
    return "highest-temperature-in-" in text or "highest temperature" in text or "high temperature" in text


def _matches_date(text: str, dates: List[Dict[str, str]]) -> bool:
    for item in dates:
        candidates = (
            item["iso"],
            f"{item['month']} {item['day']}",
            f"{item['monthShort']} {item['day']}",
            f"{item['month']} {item['day']} {item['year']}",
            f"{item['monthShort']} {item['day']} {item['year']}",
        )
        if any(candidate in text for candidate in candidates):
            return True
    return False


def _matched_date_iso(text: str, dates: List[Dict[str, str]]) -> Optional[str]:
    for item in dates:
        candidates = (
            item["iso"],
            f"{item['month']} {item['day']}",
            f"{item['monthShort']} {item['day']}",
            f"{item['month']} {item['day']} {item['year']}",
            f"{item['monthShort']} {item['day']} {item['year']}",
        )
        if any(candidate in text for candidate in candidates):
            return item["iso"]
    return None


def _date_window_bounds(ctx: dict, dates: List[Dict[str, str]]) -> Tuple[str, str]:
    now = datetime.fromisoformat(_utc_now_iso(ctx).replace("Z", "+00:00"))
    first = datetime.fromisoformat(dates[0]["iso"]).replace(tzinfo=timezone.utc) if dates else now
    last = datetime.fromisoformat(dates[-1]["iso"]).replace(tzinfo=timezone.utc) if dates else now
    start = min(now - timedelta(days=1), first - timedelta(hours=12))
    end = last + timedelta(days=2)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z")


def _weather_by_city(ctx: dict, cities: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    if not cities:
        return {}
    base_url = str(getattr(ctx["SETTINGS"], "open_meteo_api_url", "") or "").strip()
    if not base_url:
        raise RuntimeError("open meteo api url missing")
    payload = ctx["http_json_get"](
        base_url,
        params={
            "latitude": ",".join(str(city["lat"]) for city in cities),
            "longitude": ",".join(str(city["lon"]) for city in cities),
            "current": "temperature_2m,weather_code",
            "hourly": "temperature_2m",
            "daily": "temperature_2m_max,temperature_2m_min",
            "forecast_days": 7,
            "timezone": "auto",
        },
        timeout=18,
        headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
    )
    responses = payload if isinstance(payload, list) else [payload]
    by_city: Dict[str, Dict[str, Any]] = {}
    for city, row in zip(cities, responses):
        if not isinstance(row, dict):
            continue
        unit = str(city.get("unit") or "F").upper()
        current = row.get("current") if isinstance(row.get("current"), dict) else {}
        daily = row.get("daily") if isinstance(row.get("daily"), dict) else {}
        hourly = row.get("hourly") if isinstance(row.get("hourly"), dict) else {}
        hourly_times = hourly.get("time") if isinstance(hourly.get("time"), list) else []
        hourly_temps = hourly.get("temperature_2m") if isinstance(hourly.get("temperature_2m"), list) else []
        daily_dates = daily.get("time") if isinstance(daily.get("time"), list) else []
        daily_highs = daily.get("temperature_2m_max") if isinstance(daily.get("temperature_2m_max"), list) else []
        daily_lows = daily.get("temperature_2m_min") if isinstance(daily.get("temperature_2m_min"), list) else []
        daily_rows = [
            {"date": day, "high": _c_to_unit(high, unit), "low": _c_to_unit(low, unit)}
            for day, high, low in zip(daily_dates[:7], daily_highs[:7], daily_lows[:7])
        ]
        by_city[str(city["city_id"])] = {
            "condition": describe_weather_code(current.get("weather_code")),
            "currentTemp": _c_to_unit(current.get("temperature_2m"), unit),
            "todayHigh": daily_rows[0]["high"] if daily_rows else None,
            "todayLow": daily_rows[0]["low"] if daily_rows else None,
            "forecastHigh": max([row["high"] for row in daily_rows if row.get("high") is not None], default=None),
            "hourly": [{"time": time_value, "temp": _c_to_unit(temp, unit)} for time_value, temp in zip(hourly_times[:24], hourly_temps[:24])],
            "daily": daily_rows,
            "updatedAt": current.get("time") or row.get("generationtime_ms"),
        }
    return by_city


def _metar_by_city(ctx: dict, cities: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    ids = [str(city.get("icao") or "").strip().upper() for city in cities if city.get("icao")]
    if not ids:
        return {}
    base_url = str(getattr(ctx["SETTINGS"], "aviationweather_metar_api_url", "") or "").strip()
    payload = ctx["http_json_get"](
        base_url,
        params={"ids": ",".join(ids), "format": "json", "hours": "24"},
        timeout=18,
        headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
    )
    rows = payload if isinstance(payload, list) else ((payload or {}).get("data") or [])
    by_icao: Dict[str, Dict[str, Any]] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        icao = str(row.get("icaoId") or row.get("station_id") or row.get("id") or "").strip().upper()
        if not icao:
            continue
        by_icao[icao] = row
    result: Dict[str, Dict[str, Any]] = {}
    for city in cities:
        row = by_icao.get(str(city.get("icao") or "").upper())
        if row:
            result[str(city["city_id"])] = {"metarTemp": _c_to_unit(row.get("temp") or row.get("temp_c"), str(city.get("unit") or "F")), "updatedAt": row.get("reportTime") or row.get("obsTime")}
    return result


def _fetch_gamma_events_for_query(ctx: dict, query: str) -> Tuple[List[Dict[str, Any]], str]:
    base_url = str(ctx["SETTINGS"].gamma_api_base or "").rstrip("/")
    if not base_url:
        return [], "empty"
    try:
        payload = ctx["http_json_get"](
            f"{base_url}/events",
            params={"active": "true", "closed": "false", "limit": 80, "q": query},
            timeout=GAMMA_QUERY_TIMEOUT_SECONDS,
            headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
        )
    except Exception as exc:
        logger = getattr(ctx.get("app"), "logger", None)
        if logger is not None:
            logger.exception("global weather map gamma query failed query=%s error=%s", query, exc)
        return [], "error"
    rows = payload if isinstance(payload, list) else ((payload or {}).get("events") or (payload or {}).get("data") or [])
    if not isinstance(rows, list):
        return [], "empty"
    events = [event for event in rows if isinstance(event, dict)]
    return events, "ok" if events else "empty"


def _fetch_gamma_events(ctx: dict, queries: Iterable[str]) -> Tuple[List[Dict[str, Any]], str]:
    events: List[Dict[str, Any]] = []
    seen: set[str] = set()
    statuses: List[str] = []
    for query in queries:
        rows, status = _fetch_gamma_events_for_query(ctx, query)
        statuses.append(status)
        for event in rows:
            identity = str(event.get("id") or event.get("slug") or "")
            if identity and identity not in seen:
                seen.add(identity)
                events.append(event)
        if GAMMA_QUERY_PAUSE_SECONDS > 0:
            time.sleep(GAMMA_QUERY_PAUSE_SECONDS)
    if events:
        return events, "ok"
    if statuses and all(status == "error" for status in statuses):
        return [], "error"
    if any(status == "error" for status in statuses):
        return [], "partial"
    return [], "empty"


def _market_label(event_title: str, market: Dict[str, Any]) -> str:
    label = str(market.get("groupItemTitle") or market.get("group_item_title") or "").strip()
    if label:
        return label
    question = str(market.get("question") or market.get("title") or "").strip()
    if event_title and question.startswith(event_title):
        suffix = question[len(event_title) :].strip(" -:·")
        if suffix:
            return suffix
    return question or str(market.get("slug") or market.get("id") or "temperature bin")


def _market_yes_price(market: Dict[str, Any]) -> Optional[float]:
    prices = _as_list(market.get("outcomePrices") or market.get("outcome_prices"))
    return _float(prices[0]) if prices else None


def _token_ids(market: Dict[str, Any]) -> List[str]:
    candidates = (
        market.get("clobTokenIds"),
        market.get("clob_token_ids"),
        market.get("tokens"),
        market.get("outcomeTokenIds"),
        market.get("outcome_token_ids"),
    )
    for candidate in candidates:
        values = _as_list(candidate)
        token_ids: List[str] = []
        for value in values:
            if isinstance(value, dict):
                token = value.get("token_id") or value.get("tokenId") or value.get("id")
            else:
                token = value
            if token:
                token_ids.append(str(token))
        if token_ids:
            return token_ids
    return []


def _clob_yes_quote(ctx: dict, market: Dict[str, Any]) -> Dict[str, Optional[float]]:
    token_ids = _token_ids(market)
    if not token_ids:
        return {"bestBidYes": None, "bestAskYes": None}
    base_url = str(getattr(ctx["SETTINGS"], "clob_api_base", "") or "").rstrip("/")
    if not base_url:
        return {"bestBidYes": None, "bestAskYes": None}
    stats = ctx.setdefault("_weather_clob_stats", {"attempts": 0, "errors": 0, "quoted": 0})
    stats["attempts"] = int(stats.get("attempts") or 0) + 1
    try:
        book = ctx["http_json_get"](
            f"{base_url}/book",
            params={"token_id": token_ids[0]},
            timeout=min(4, int(getattr(ctx["SETTINGS"], "clob_timeout_seconds", 8) or 8)),
            headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
        )
    except Exception:
        stats["errors"] = int(stats.get("errors") or 0) + 1
        return {"bestBidYes": None, "bestAskYes": None}
    bids = book.get("bids") if isinstance(book, dict) and isinstance(book.get("bids"), list) else []
    asks = book.get("asks") if isinstance(book, dict) and isinstance(book.get("asks"), list) else []
    best_bid = max((_float(row.get("price") if isinstance(row, dict) else None) for row in bids), default=None)
    best_ask = min((_float(row.get("price") if isinstance(row, dict) else None) for row in asks), default=None)
    if best_bid is not None or best_ask is not None:
        stats["quoted"] = int(stats.get("quoted") or 0) + 1
    return {"bestBidYes": best_bid, "bestAskYes": best_ask}


def _normalize_temperature_event(ctx: dict, event: Dict[str, Any], city: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    event_title = str(event.get("title") or "").strip()
    markets = [market for market in (event.get("markets") or []) if isinstance(market, dict) and market.get("closed") is not True]
    bins: List[Dict[str, Any]] = []
    for market in markets:
        label = _market_label(event_title, market)
        parsed = parse_temperature_bin(label, default_unit=str(city.get("unit") or "F"))
        if not parsed:
            continue
        fallback = _market_yes_price(market)
        clob = _clob_yes_quote(ctx, market)
        bid = clob.get("bestBidYes")
        ask = clob.get("bestAskYes")
        mid = round((bid + ask) / 2, 4) if bid is not None and ask is not None else fallback
        bins.append(
            {
                **parsed,
                "bestBidYes": bid,
                "bestAskYes": ask,
                "midPriceYes": round(float(mid), 4) if mid is not None else None,
                "marketSlug": market.get("slug") or market.get("market_slug"),
                "marketStatus": "live" if market.get("active") is not False else "inactive",
            }
        )
    if not bins:
        return None
    bins.sort(key=lambda row: float(row.get("sortKey") or 0))
    quoted = len([row for row in bins if row.get("midPriceYes") is not None])
    top = max([row for row in bins if row.get("midPriceYes") is not None], key=lambda row: float(row.get("midPriceYes") or 0), default=None)
    slug = event.get("slug")
    return {
        "eventSlug": slug,
        "eventTitle": event_title,
        "eventStatus": "live" if event.get("active") is not False and event.get("closed") is not True else "inactive",
        "marketUrl": f"https://polymarket.com/event/{slug}" if slug else None,
        "quoteCoverage": f"{quoted}/{len(bins)}",
        "topBin": top,
        "bins": bins,
        "updatedAt": event.get("updatedAt") or event.get("endDate") or event.get("createdAt"),
    }


def _db_temperature_rows(ctx: dict, dates: List[Dict[str, str]]) -> Tuple[List[Dict[str, Any]], str]:
    connector = ctx.get("get_connection")
    if not callable(connector):
        return [], "empty"
    start_iso, end_iso = _date_window_bounds(ctx, dates)
    conn = None
    try:
        try:
            conn = connector(ctx.get("DB_PATH"), readonly=True)
        except TypeError:
            conn = connector(ctx.get("DB_PATH"))
        cursor = conn.execute(
            """
            SELECT
                m.id AS market_id,
                m.gamma_market_id,
                m.slug,
                m.condition_id,
                m.yes_token_id,
                m.no_token_id,
                m.clob_token_ids,
                m.title,
                m.description,
                m.end_date,
                m.created_at,
                mlp.latest_yes_price,
                mlp.latest_price AS latest_trade_price,
                mlp.latest_trade_at,
                mls.latest_price AS serving_latest_price,
                mls.latest_trade_at AS serving_latest_trade_at,
                mss.is_trading_closed,
                mss.is_resolved,
                mss.gamma_closed
            FROM markets m
            LEFT JOIN market_latest_prices mlp ON mlp.market_id = m.id
            LEFT JOIN market_list_serving mls ON mls.market_id = m.id
            LEFT JOIN market_status_snapshot mss ON mss.market_id = m.id
            WHERE
                (
                    lower(COALESCE(m.title, '')) LIKE '%%highest temperature%%'
                    OR lower(COALESCE(m.slug, '')) LIKE 'highest-temperature-in-%%'
                )
                AND (m.end_date IS NULL OR (m.end_date >= ? AND m.end_date <= ?))
            ORDER BY m.end_date ASC, m.id ASC
            LIMIT 6000
            """,
            (start_iso, end_iso),
        )
        rows = [_row_to_dict(row) for row in cursor.fetchall()]
        return rows, "ok" if rows else "empty"
    except Exception as exc:
        logger = getattr(ctx.get("app"), "logger", None)
        if logger is not None:
            logger.exception("global weather map market db query failed error=%s", exc)
        return [], "error"
    finally:
        if conn is not None and hasattr(conn, "close"):
            try:
                conn.close()
            except Exception:
                pass


def _db_market_object(row: Dict[str, Any]) -> Dict[str, Any]:
    token_ids = _as_list(row.get("clob_token_ids"))
    if not token_ids and row.get("yes_token_id"):
        token_ids = [row.get("yes_token_id"), row.get("no_token_id")]
    return {
        "id": row.get("market_id"),
        "slug": row.get("slug"),
        "question": row.get("title"),
        "title": row.get("title"),
        "clobTokenIds": [token for token in token_ids if token],
        "active": not (_truthy(row.get("is_trading_closed")) or _truthy(row.get("is_resolved")) or _truthy(row.get("gamma_closed"))),
    }


def _db_price_fallback(row: Dict[str, Any]) -> Optional[float]:
    for key in ("latest_yes_price", "latest_trade_price", "serving_latest_price"):
        price = _float(row.get(key))
        if price is not None:
            return round(price, 4)
    return None


def _fetch_gamma_market_by_id(ctx: dict, market_id: Any) -> Optional[Dict[str, Any]]:
    if not market_id:
        return None
    cache = ctx.setdefault("_weather_gamma_market_cache", {})
    key = str(market_id)
    if key in cache:
        return cache[key]
    base_url = str(ctx["SETTINGS"].gamma_api_base or "").rstrip("/")
    if not base_url:
        cache[key] = None
        return None
    stats = ctx.setdefault("_weather_gamma_market_stats", {"attempts": 0, "errors": 0, "priced": 0})
    stats["attempts"] = int(stats.get("attempts") or 0) + 1
    try:
        payload = ctx["http_json_get"](
            f"{base_url}/markets/{key}",
            timeout=GAMMA_QUERY_TIMEOUT_SECONDS,
            headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
        )
    except Exception:
        stats["errors"] = int(stats.get("errors") or 0) + 1
        cache[key] = None
        return None
    market = payload if isinstance(payload, dict) else None
    if market and _market_yes_price(market) is not None:
        stats["priced"] = int(stats.get("priced") or 0) + 1
    cache[key] = market
    return market


def _gamma_price_fallback(ctx: dict, row: Dict[str, Any]) -> Tuple[Optional[float], Optional[Dict[str, Any]]]:
    market = _fetch_gamma_market_by_id(ctx, row.get("gamma_market_id"))
    price = _market_yes_price(market or {})
    return (round(price, 4) if price is not None else None), market


def _prefetch_gamma_markets(ctx: dict, rows: Iterable[Dict[str, Any]]) -> None:
    cache = ctx.setdefault("_weather_gamma_market_cache", {})
    ids: List[str] = []
    seen: set[str] = set()
    for row in rows:
        if _db_price_fallback(row) is not None:
            continue
        market_id = row.get("gamma_market_id")
        if not market_id:
            continue
        key = str(market_id)
        if key in seen or key in cache:
            continue
        seen.add(key)
        ids.append(key)
    if not ids:
        return
    max_workers = max(1, min(16, len(ids)))
    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="weather-gamma-market") as executor:
        futures = [executor.submit(_fetch_gamma_market_by_id, ctx, market_id) for market_id in ids]
        for future in as_completed(futures):
            try:
                future.result()
            except Exception:
                pass


def _normalize_temperature_db_group(ctx: dict, city: Dict[str, Any], date_iso: str, rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    bins: List[Dict[str, Any]] = []
    for row in rows:
        market = _db_market_object(row)
        label = str(row.get("title") or row.get("slug") or "").strip()
        parsed = parse_temperature_bin(label, default_unit=str(city.get("unit") or "F"))
        if not parsed:
            continue
        fallback = _db_price_fallback(row)
        gamma_market = None
        if fallback is None:
            fallback, gamma_market = _gamma_price_fallback(ctx, row)
        if gamma_market:
            market = {**market, **gamma_market}
        clob = {"bestBidYes": None, "bestAskYes": None} if fallback is not None else _clob_yes_quote(ctx, market)
        bid = clob.get("bestBidYes")
        ask = clob.get("bestAskYes")
        mid = round((bid + ask) / 2, 4) if bid is not None and ask is not None else fallback
        bins.append(
            {
                **parsed,
                "bestBidYes": bid,
                "bestAskYes": ask,
                "midPriceYes": round(float(mid), 4) if mid is not None else None,
                "marketSlug": row.get("slug"),
                "marketStatus": "live" if market.get("active") else "inactive",
            }
        )
    if not bins:
        return None
    bins.sort(key=lambda item: float(item.get("sortKey") or 0))
    quoted = len([row for row in bins if row.get("midPriceYes") is not None])
    top = max([row for row in bins if row.get("midPriceYes") is not None], key=lambda row: float(row.get("midPriceYes") or 0), default=None)
    if top is None:
        forecast_high = _float(city.get("forecastHigh"))
        if forecast_high is not None:
            top = min(bins, key=lambda row: abs(float(row.get("sortKey") or 0) - forecast_high))
    city_slug = _slugify(city.get("city"))
    date_slug = ""
    try:
        parsed_date = datetime.fromisoformat(date_iso)
        date_slug = parsed_date.strftime("on-%B-%-d-%Y").lower()
    except Exception:
        date_slug = date_iso
    event_slug = f"highest-temperature-in-{city_slug}-{date_slug}".strip("-")
    updated_at = max(
        (
            _json_safe_value(row.get("serving_latest_trade_at") or row.get("latest_trade_at") or row.get("end_date") or row.get("created_at"))
            for row in rows
        ),
        key=_parse_ts,
        default=None,
    )
    return {
        "eventSlug": event_slug,
        "eventTitle": f"Highest temperature in {city.get('city')} on {date_iso}?",
        "eventStatus": "live" if any((not _truthy(row.get("is_trading_closed")) and not _truthy(row.get("is_resolved")) and not _truthy(row.get("gamma_closed"))) for row in rows) else "inactive",
        "marketUrl": f"https://polymarket.com/event/{event_slug}",
        "quoteCoverage": f"{quoted}/{len(bins)}",
        "topBin": top,
        "bins": bins,
        "updatedAt": updated_at,
    }


def _db_markets_by_city(ctx: dict, cities: List[Dict[str, Any]], dates: List[Dict[str, str]]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    rows, db_status = _db_temperature_rows(ctx, dates)
    if not rows:
        return {}, {str(city["city_id"]): db_status for city in cities}

    date_order = {item["iso"]: index for index, item in enumerate(dates)}
    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    city_by_id = {str(city["city_id"]): city for city in cities}
    for row in rows:
        if _truthy(row.get("is_resolved")):
            continue
        haystack = _normalize_text(row.get("title"), row.get("description"), row.get("slug"))
        if not _matches_high_temperature_market(haystack) or not _matches_date(haystack, dates):
            continue
        date_iso = _matched_date_iso(haystack, dates)
        if not date_iso:
            continue
        for city in cities:
            if _matches_alias(haystack, city):
                grouped.setdefault((str(city["city_id"]), date_iso), []).append(row)
                break

    result: Dict[str, Dict[str, Any]] = {}
    source_states: Dict[str, str] = {}
    selected_groups: Dict[str, Tuple[Dict[str, Any], str, List[Dict[str, Any]]]] = {}
    for city_id, city in city_by_id.items():
        candidate_groups: List[Tuple[int, int, float, str, List[Dict[str, Any]]]] = []
        for (group_city_id, date_iso), group_rows in grouped.items():
            if group_city_id != city_id:
                continue
            newest = max((_parse_ts(row.get("serving_latest_trade_at") or row.get("latest_trade_at") or row.get("end_date") or row.get("created_at")) for row in group_rows), default=0.0)
            candidate_groups.append((date_order.get(date_iso, 999), -len(group_rows), -newest, date_iso, group_rows))
        candidate_groups.sort(key=lambda item: (item[0], item[1], item[2]))
        if candidate_groups:
            _, _, _, date_iso, group_rows = candidate_groups[0]
            selected_groups[city_id] = (city, date_iso, group_rows)
        else:
            source_states[city_id] = "empty" if db_status == "ok" else db_status

    _prefetch_gamma_markets(ctx, (row for _, _, group_rows in selected_groups.values() for row in group_rows))
    for city_id, (city, date_iso, group_rows) in selected_groups.items():
        normalized = _normalize_temperature_db_group(ctx, city, date_iso, group_rows)
        if normalized:
            result[city_id] = normalized
            source_states[city_id] = "ok"
        else:
            source_states[city_id] = "partial"
    return result, source_states


def _market_source_status(stats: Dict[str, Any]) -> str:
    if stats.get("match"):
        return "ok"
    query_statuses = list(stats.get("queryStatuses") or [])
    if query_statuses and all(status == "error" for status in query_statuses):
        return "error"
    if any(status == "error" for status in query_statuses):
        return "partial"
    return "empty"


def _markets_by_city(ctx: dict, cities: List[Dict[str, Any]]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    dates = _date_labels(ctx, int(getattr(ctx["SETTINGS"], "global_weather_market_days", 4) or 4))
    result, source_states = _db_markets_by_city(ctx, cities, dates)
    missing_cities = [city for city in cities if str(city["city_id"]) not in result]
    for city in missing_cities:
        city_id = str(city["city_id"])
        name = str(city.get("city") or "").strip()
        queries = [f"{name} temperature", f"{name} highest temperature"][:GAMMA_QUERIES_PER_CITY]
        events, query_status = _fetch_gamma_events(ctx, queries)
        stats = {"queryStatuses": [query_status], "match": False}
        matches: List[Dict[str, Any]] = []
        for event in events:
            haystack = _normalize_text(event.get("title"), event.get("slug"), " ".join(str((market or {}).get("question") or "") for market in event.get("markets") or []))
            if _matches_alias(haystack, city) and _matches_weather_market(haystack) and _matches_date(haystack, dates):
                normalized = _normalize_temperature_event(ctx, event, city)
                if normalized:
                    matches.append(normalized)
        if matches:
            matches.sort(key=lambda row: (_parse_ts(row.get("updatedAt")), len(row.get("bins") or [])), reverse=True)
            result[city_id] = matches[0]
            stats["match"] = True
        gamma_status = _market_source_status(stats)
        prior_status = source_states.get(city_id)
        if gamma_status == "ok" or prior_status in {None, "", "empty"}:
            source_states[city_id] = gamma_status
        else:
            source_states[city_id] = prior_status
    return result, source_states


def _aggregate_source(values: Iterable[str], *, empty_value: str = "empty") -> str:
    states = [str(value or "") for value in values if value]
    if not states:
        return empty_value
    if any(state == "ok" for state in states):
        return "partial" if any(state in {"error", "partial"} for state in states) else "ok"
    if any(state == "partial" for state in states):
        return "partial"
    if all(state == "error" for state in states):
        return "error"
    return empty_value


def _source_status(value: bool) -> str:
    return "ok" if value else "error"


def build_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    mapped = [
        item for item in items
        if item.get("currentTemp") is not None or item.get("metarTemp") is not None
    ]
    markets = [item for item in items if item.get("eventSlug")]
    stale = [item for item in items if "error" in set((item.get("sourceStates") or {}).values())]
    hottest = max(
        mapped,
        key=lambda row: float(
            row.get("forecastHigh")
            if row.get("forecastHigh") is not None
            else row.get("currentTemp")
            if row.get("currentTemp") is not None
            else row.get("metarTemp")
            if row.get("metarTemp") is not None
            else -999
        ),
        default=None,
    )
    return {
        "cityCount": len(items),
        "mappedCount": len(mapped),
        "liveMarketCount": len(markets),
        "staleCount": len(stale),
        "hottestCity": hottest,
    }


def build_global_weather_map_payload(ctx: dict, *, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    cities = load_weather_cities(limit=limit)
    sources: Dict[str, str] = {}
    try:
        weather = _weather_by_city(ctx, cities)
        sources["openMeteo"] = _source_status(bool(weather))
    except Exception as exc:
        weather = {}
        sources["openMeteo"] = "error"
        logger = getattr(ctx.get("app"), "logger", None)
        if logger is not None:
            logger.exception("global weather map open-meteo fetch failed error=%s", exc)
    try:
        metar = _metar_by_city(ctx, cities)
        sources["aviationWeather"] = _source_status(bool(metar))
    except Exception as exc:
        metar = {}
        sources["aviationWeather"] = "error"
        logger = getattr(ctx.get("app"), "logger", None)
        if logger is not None:
            logger.exception("global weather map metar fetch failed error=%s", exc)
    try:
        markets, market_source_states = _markets_by_city(ctx, cities)
        sources["gamma"] = _aggregate_source(market_source_states.values())
        clob_stats = ctx.get("_weather_clob_stats") or {}
        clob_attempts = int(clob_stats.get("attempts") or 0)
        clob_errors = int(clob_stats.get("errors") or 0)
        clob_quoted = int(clob_stats.get("quoted") or 0)
        if clob_attempts == 0:
            sources["clob"] = "empty"
        elif clob_quoted > 0 and clob_errors == 0:
            sources["clob"] = "ok"
        elif clob_quoted > 0:
            sources["clob"] = "partial"
        else:
            sources["clob"] = "empty"
    except Exception as exc:
        markets = {}
        market_source_states = {str(city["city_id"]): "error" for city in cities}
        sources["gamma"] = "error"
        sources["clob"] = "error"
        logger = getattr(ctx.get("app"), "logger", None)
        if logger is not None:
            logger.exception("global weather map polymarket fetch failed error=%s", exc)

    items: List[Dict[str, Any]] = []
    for city in cities:
        city_id = str(city["city_id"])
        weather_row = weather.get(city_id) or {}
        metar_row = metar.get(city_id) or {}
        market_row = markets.get(city_id) or {}
        item = {
            "cityId": city_id,
            "city": city.get("city"),
            "country": city.get("country"),
            "region": city.get("region"),
            "lat": city.get("lat"),
            "lon": city.get("lon"),
            "timezone": city.get("timezone"),
            "unit": city.get("unit"),
            "icao": city.get("icao"),
            "labelDx": city.get("label_dx"),
            "labelDy": city.get("label_dy"),
            **weather_row,
            **metar_row,
            **market_row,
            "sourceStates": {
                "openMeteo": "ok" if weather_row else "error",
                "metar": "ok" if metar_row else "empty",
                "polymarket": "ok" if market_row else market_source_states.get(city_id, "empty"),
            },
            "updatedAt": weather_row.get("updatedAt") or metar_row.get("updatedAt") or market_row.get("updatedAt") or _utc_now_iso(ctx),
        }
        items.append(item)
    summary = build_summary(items)
    status = "ok" if summary["mappedCount"] else "warming"
    if status == "ok" and any(value == "error" for value in sources.values()):
        status = "degraded"
    return {
        "generatedAt": _utc_now_iso(ctx),
        "source": "Open-Meteo + AviationWeather + Polymarket Gamma/CLOB",
        "sourceUrl": getattr(ctx["SETTINGS"], "weather_source_url", "https://open-meteo.com/"),
        "status": status,
        "sources": sources,
        "summary": summary,
        "items": items,
    }


def _empty_payload(ctx: dict, *, status: str = "warming") -> Dict[str, Any]:
    return {
        "generatedAt": _utc_now_iso(ctx),
        "source": "Open-Meteo + AviationWeather + Polymarket Gamma/CLOB",
        "sourceUrl": getattr(ctx["SETTINGS"], "weather_source_url", "https://open-meteo.com/"),
        "status": status,
        "sources": {},
        "summary": {"cityCount": 0, "mappedCount": 0, "liveMarketCount": 0, "staleCount": 0, "hottestCity": None},
        "items": [],
    }


def normalize_global_weather_map_payload(payload: Any, *, ctx: dict, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return _empty_payload(ctx, status="invalid")
    result = json.loads(json.dumps(payload, ensure_ascii=True, default=str))
    items = [item for item in (result.get("items") or []) if isinstance(item, dict)]
    result["items"] = items[: max(1, min(int(limit or DEFAULT_ITEM_LIMIT), 60))]
    result["summary"] = result.get("summary") if isinstance(result.get("summary"), dict) else build_summary(result["items"])
    result["generatedAt"] = str(result.get("generatedAt") or _utc_now_iso(ctx))
    result["status"] = str(result.get("status") or ("ok" if result["items"] else "warming"))
    result["source"] = str(result.get("source") or "Open-Meteo + AviationWeather + Polymarket Gamma/CLOB")
    result["sourceUrl"] = str(result.get("sourceUrl") or getattr(ctx["SETTINGS"], "weather_source_url", "https://open-meteo.com/"))
    return result


def _with_cache_mode(payload: Dict[str, Any], cache_mode: str) -> Dict[str, Any]:
    return {**payload, "cacheMode": cache_mode}


def _read_seeded_snapshot(ctx: dict, *, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    reader = ctx.get("get_cached_json")
    if callable(reader):
        payload = reader(GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE, GLOBAL_WEATHER_MAP_CACHE_KEY)
        if isinstance(payload, dict):
            return _with_cache_mode(payload, "redis-seed")
    store = ctx.get("SNAPSHOT_STORE")
    if store is None:
        return None
    payload = store.get(GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE, GLOBAL_WEATHER_MAP_CACHE_KEY)
    if isinstance(payload, dict):
        return _with_cache_mode(payload, "sqlite-seed")
    stale = store.get_stale(GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE, GLOBAL_WEATHER_MAP_CACHE_KEY)
    if isinstance(stale, dict):
        return _with_cache_mode(stale, "stale-seed")
    return None


def _store_live(ctx: dict, payload: Dict[str, Any], *, ttl_seconds: int) -> None:
    store = ctx.get("SNAPSHOT_STORE")
    if store is not None:
        store.set(GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE, GLOBAL_WEATHER_MAP_CACHE_KEY, payload, ttl_seconds)
    setter = ctx.get("set_cached_json")
    if callable(setter):
        setter(GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE, GLOBAL_WEATHER_MAP_CACHE_KEY, payload, ttl_seconds)


def _schedule_live_refresh(ctx: dict, *, limit: int, ttl_seconds: int, reason: str) -> bool:
    refresh_key = f"{GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE}:{GLOBAL_WEATHER_MAP_CACHE_KEY}"
    with _LIVE_REFRESH_LOCK:
        if refresh_key in _LIVE_REFRESHING:
            return False
        _LIVE_REFRESHING.add(refresh_key)

    def refresh() -> None:
        logger = getattr(ctx.get("app"), "logger", None)
        try:
            payload = _with_cache_mode(build_global_weather_map_payload(ctx, limit=limit), "live-build")
            if payload.get("items"):
                _store_live(ctx, payload, ttl_seconds=ttl_seconds)
                if logger is not None and hasattr(logger, "info"):
                    logger.info("global weather map async refresh stored reason=%s items=%s", reason, len(payload.get("items") or []))
            elif logger is not None and hasattr(logger, "warning"):
                logger.warning("global weather map async refresh skipped empty payload reason=%s", reason)
        except Exception:
            if logger is not None:
                logger.exception("global weather map async refresh failed reason=%s", reason)
        finally:
            with _LIVE_REFRESH_LOCK:
                _LIVE_REFRESHING.discard(refresh_key)

    thread = threading.Thread(target=refresh, name="global-weather-map-refresh", daemon=True)
    thread.start()
    return True


def get_global_weather_map_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT, *, allow_live_build: bool = True) -> Dict[str, Any]:
    ttl_seconds = max(60, int(getattr(ctx["SETTINGS"], "global_weather_map_ttl_seconds", 300) or 300))
    seeded = _read_seeded_snapshot(ctx, ttl_seconds=ttl_seconds)
    if seeded is not None:
        if allow_live_build and seeded.get("cacheMode") == "stale-seed":
            _schedule_live_refresh(ctx, limit=limit, ttl_seconds=ttl_seconds, reason="stale-seed")
        return normalize_global_weather_map_payload(seeded, ctx=ctx, limit=limit)
    if not allow_live_build:
        return normalize_global_weather_map_payload({**_empty_payload(ctx), "cacheMode": "seed-miss"}, ctx=ctx, limit=limit)
    scheduled = _schedule_live_refresh(ctx, limit=limit, ttl_seconds=ttl_seconds, reason="seed-miss")
    return normalize_global_weather_map_payload({**_empty_payload(ctx), "cacheMode": "seed-miss-refreshing" if scheduled else "seed-miss-refresh-inflight"}, ctx=ctx, limit=limit)
