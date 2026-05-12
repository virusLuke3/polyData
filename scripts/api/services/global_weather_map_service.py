from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from weather.cities import load_weather_cities
from weather.temperature_bins import parse_temperature_bin
from weather.weather_codes import describe_weather_code


GLOBAL_WEATHER_MAP_SNAPSHOT_NAMESPACE = "snapshot:weather:global-map"
GLOBAL_WEATHER_MAP_CACHE_KEY = "panel-v1"
DEFAULT_ITEM_LIMIT = 34

WEATHER_MARKET_TERMS = ("temperature", "highest temperature", "high temperature", "weather")


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


def _matches_alias(text: str, city: Dict[str, Any]) -> bool:
    aliases = [city.get("city"), *list(city.get("polymarket_aliases") or [])]
    for alias in aliases:
        normalized = str(alias or "").strip().lower()
        if normalized and re.search(r"(?<![a-z0-9])" + re.escape(normalized).replace(r"\ ", r"\s+") + r"(?![a-z0-9])", text):
            return True
    return False


def _matches_weather_market(text: str) -> bool:
    return any(term in text for term in WEATHER_MARKET_TERMS)


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


def _fetch_gamma_events(ctx: dict, queries: Iterable[str]) -> List[Dict[str, Any]]:
    base_url = str(ctx["SETTINGS"].gamma_api_base or "").rstrip("/")
    if not base_url:
        return []
    events: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for query in queries:
        payload = ctx["http_json_get"](
            f"{base_url}/events",
            params={"active": "true", "closed": "false", "limit": 100, "q": query},
            timeout=12,
            headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
        )
        rows = payload if isinstance(payload, list) else ((payload or {}).get("events") or (payload or {}).get("data") or [])
        if not isinstance(rows, list):
            continue
        for event in rows:
            if not isinstance(event, dict):
                continue
            identity = str(event.get("id") or event.get("slug") or "")
            if identity and identity not in seen:
                seen.add(identity)
                events.append(event)
    return events


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
    try:
        book = ctx["http_json_get"](
            f"{base_url}/book",
            params={"token_id": token_ids[0]},
            timeout=int(getattr(ctx["SETTINGS"], "clob_timeout_seconds", 8) or 8),
            headers={"Accept": "application/json", "User-Agent": "polydata-weather-map/1.0"},
        )
    except Exception:
        return {"bestBidYes": None, "bestAskYes": None}
    bids = book.get("bids") if isinstance(book, dict) and isinstance(book.get("bids"), list) else []
    asks = book.get("asks") if isinstance(book, dict) and isinstance(book.get("asks"), list) else []
    best_bid = max((_float(row.get("price") if isinstance(row, dict) else None) for row in bids), default=None)
    best_ask = min((_float(row.get("price") if isinstance(row, dict) else None) for row in asks), default=None)
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


def _markets_by_city(ctx: dict, cities: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    dates = _date_labels(ctx, int(getattr(ctx["SETTINGS"], "global_weather_market_days", 4) or 4))
    queries = []
    for city in cities:
        name = str(city.get("city") or "").strip()
        queries.extend([f"{name} temperature", f"{name} highest temperature", f"{name} weather"])
    events = _fetch_gamma_events(ctx, queries)
    result: Dict[str, Dict[str, Any]] = {}
    for city in cities:
        city_id = str(city["city_id"])
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
    return result


def _source_status(value: bool) -> str:
    return "ok" if value else "error"


def build_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    mapped = [item for item in items if item.get("currentTemp") is not None]
    markets = [item for item in items if item.get("eventSlug")]
    stale = [item for item in items if "error" in set((item.get("sourceStates") or {}).values())]
    hottest = max(mapped, key=lambda row: float(row.get("forecastHigh") if row.get("forecastHigh") is not None else row.get("currentTemp") or -999), default=None)
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
        markets = _markets_by_city(ctx, cities)
        sources["gamma"] = "ok" if markets else "empty"
        sources["clob"] = "partial" if markets else "empty"
    except Exception as exc:
        markets = {}
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
                "polymarket": "ok" if market_row else "empty",
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


def get_global_weather_map_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT, *, allow_live_build: bool = True) -> Dict[str, Any]:
    ttl_seconds = max(60, int(getattr(ctx["SETTINGS"], "global_weather_map_ttl_seconds", 300) or 300))
    seeded = _read_seeded_snapshot(ctx, ttl_seconds=ttl_seconds)
    if seeded is not None:
        return normalize_global_weather_map_payload(seeded, ctx=ctx, limit=limit)
    if not allow_live_build:
        return normalize_global_weather_map_payload({**_empty_payload(ctx), "cacheMode": "seed-miss"}, ctx=ctx, limit=limit)
    payload = _with_cache_mode(build_global_weather_map_payload(ctx, limit=limit), "live-build")
    if payload.get("items"):
        _store_live(ctx, payload, ttl_seconds=ttl_seconds)
    return normalize_global_weather_map_payload(payload, ctx=ctx, limit=limit)

