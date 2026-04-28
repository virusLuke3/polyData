from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _safe_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _millis_to_iso(value: Any) -> Optional[str]:
    millis = _safe_int(value)
    if millis is None or millis <= 0:
        return None
    return datetime.fromtimestamp(millis / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _asset_from_symbol(symbol: str) -> str:
    text = str(symbol or "").upper().strip()
    for suffix in ("USDT", "USDC", "USD", "PERP"):
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)]
    return text or "N/A"


def _severity(rate: Optional[float]) -> tuple[str, str, float]:
    if rate is None:
        return "unknown", "neutral", 0.0
    abs_percent = abs(rate * 100)
    if abs_percent >= 0.015:
        return "extreme funding", "critical", abs_percent
    if abs_percent >= 0.008:
        return "elevated funding", "warning", abs_percent
    return "normal funding", "normal", abs_percent


def _direction(rate: Optional[float]) -> str:
    if rate is None:
        return "flat"
    if rate > 0:
        return "positive"
    if rate < 0:
        return "negative"
    return "flat"


def _market_state(direction: str) -> str:
    if direction == "positive":
        return "longs-pay-shorts"
    if direction == "negative":
        return "shorts-pay-longs"
    return "flat"


def _heat_band(rate_percent: Optional[float]) -> str:
    value = abs(float(rate_percent or 0))
    if value >= 0.015:
        return "extreme"
    if value >= 0.008:
        return "strong"
    if value >= 0.003:
        return "medium"
    if value > 0:
        return "light"
    return "flat"


def _normalize_item(
    *,
    exchange: str,
    raw: Dict[str, Any],
    symbol: str,
    funding_rate: Any,
    mark_price: Any = None,
    index_price: Any = None,
    next_funding_time: Any = None,
    updated_at: Any = None,
) -> Optional[Dict[str, Any]]:
    normalized_symbol = str(symbol or "").upper().strip()
    if not normalized_symbol:
        return None
    rate = _safe_float(funding_rate)
    if rate is None:
        return None
    severity, tone, score = _severity(rate)
    asset = _asset_from_symbol(normalized_symbol)
    funding_rate_percent = rate * 100
    direction = _direction(rate)
    return {
        "id": f"{exchange.lower()}:{normalized_symbol}",
        "exchange": exchange,
        "symbol": normalized_symbol,
        "asset": asset,
        "pair": normalized_symbol,
        "fundingRate": rate,
        "fundingRatePercent": funding_rate_percent,
        "annualizedPercent": rate * 3 * 365 * 100,
        "severity": severity,
        "tone": tone,
        "abnormalScore": score,
        "direction": direction,
        "marketState": _market_state(direction),
        "heatBand": _heat_band(funding_rate_percent),
        "markPrice": _safe_float(mark_price),
        "indexPrice": _safe_float(index_price),
        "nextFundingTime": _millis_to_iso(next_funding_time),
        "updatedAt": _millis_to_iso(updated_at),
        "rawSource": raw.get("symbol") if isinstance(raw, dict) else None,
    }


def _headers(api_key: str = "", *, bybit: bool = False) -> Dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "polydata-runtime/1.0"}
    if api_key:
        headers["X-BAPI-API-KEY" if bybit else "X-MBX-APIKEY"] = api_key
    return headers


def _url_fingerprint(*urls: str) -> str:
    joined = "|".join(str(url or "") for url in urls)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:12]


def _filter_symbols(items: Iterable[Dict[str, Any]], symbols: set[str]) -> List[Dict[str, Any]]:
    return [item for item in items if str(item.get("symbol") or "").upper().strip() in symbols]


def _nearest_timestamp(values: Iterable[Optional[str]]) -> Optional[str]:
    timestamps = [value for value in values if value]
    if not timestamps:
        return None
    return min(timestamps)


def _group_asset_rows(items: List[Dict[str, Any]], *, limit: int) -> tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    venue_order: List[str] = []
    grouped: Dict[str, Dict[str, Any]] = {}

    for item in items:
        exchange = str(item.get("exchange") or "Exchange")
        if exchange not in venue_order:
            venue_order.append(exchange)
        asset_key = str(item.get("asset") or item.get("symbol") or item.get("id"))
        bucket = grouped.setdefault(
            asset_key,
            {
                "id": asset_key,
                "asset": item.get("asset") or item.get("symbol") or asset_key,
                "symbol": item.get("asset") or item.get("symbol") or asset_key,
                "quotes": [],
            },
        )
        bucket["quotes"].append(item)

    rows: List[Dict[str, Any]] = []
    for asset_key, bucket in grouped.items():
        quotes = sorted(
            bucket["quotes"],
            key=lambda quote: (
                venue_order.index(str(quote.get("exchange") or "Exchange")),
                str(quote.get("symbol") or ""),
            ),
        )
        rates = [float(quote["fundingRatePercent"]) for quote in quotes if isinstance(quote.get("fundingRatePercent"), (int, float))]
        max_abs_percent = max((abs(rate) for rate in rates), default=0.0)
        spread_percent = max(rates) - min(rates) if len(rates) >= 2 else 0.0
        consensus_percent = sum(rates) / len(rates) if rates else 0.0
        positive_count = sum(1 for quote in quotes if quote.get("direction") == "positive")
        negative_count = sum(1 for quote in quotes if quote.get("direction") == "negative")
        if positive_count and negative_count:
            bias = "mixed"
        elif positive_count:
            bias = "longs-pay"
        elif negative_count:
            bias = "shorts-pay"
        else:
            bias = "flat"
        if max_abs_percent >= 0.015:
            row_tone = "critical"
        elif max_abs_percent >= 0.008 or spread_percent >= 0.01:
            row_tone = "warning"
        else:
            row_tone = "normal"

        rows.append(
            {
                "id": asset_key,
                "asset": bucket["asset"],
                "symbol": bucket["symbol"],
                "venues": len(quotes),
                "bias": bias,
                "consensusFundingPercent": consensus_percent,
                "spreadPercent": spread_percent,
                "maxAbsFundingPercent": max_abs_percent,
                "tone": row_tone,
                "nextFundingTime": _nearest_timestamp(quote.get("nextFundingTime") for quote in quotes),
                "quotes": quotes,
            }
        )

    rows.sort(
        key=lambda row: (
            float(row.get("maxAbsFundingPercent") or 0),
            float(row.get("spreadPercent") or 0),
            str(row.get("asset") or ""),
        ),
        reverse=True,
    )
    limited_rows = rows[:limit]
    limited_items = [quote for row in limited_rows for quote in row.get("quotes", [])]
    return venue_order, limited_rows, limited_items


def _fetch_binance(ctx: dict, symbols: set[str]) -> tuple[List[Dict[str, Any]], str]:
    settings = ctx["SETTINGS"]
    url = str(settings.crypto_funding_watch_api_url or "").strip()
    if not url:
        return [], "missing-url"
    payload = ctx["http_json_get"](
        url,
        timeout=12,
        headers=_headers(settings.crypto_funding_watch_api_key),
    )
    rows = payload if isinstance(payload, list) else [payload] if isinstance(payload, dict) else []
    items = []
    for row in _filter_symbols((row for row in rows if isinstance(row, dict)), symbols):
        item = _normalize_item(
            exchange="Binance",
            raw=row,
            symbol=row.get("symbol"),
            funding_rate=row.get("lastFundingRate"),
            mark_price=row.get("markPrice"),
            index_price=row.get("indexPrice"),
            next_funding_time=row.get("nextFundingTime"),
            updated_at=row.get("time"),
        )
        if item is not None:
            items.append(item)
    return items, "ok" if items else "empty"


def _fetch_bybit(ctx: dict, symbols: set[str]) -> tuple[List[Dict[str, Any]], str]:
    settings = ctx["SETTINGS"]
    url = str(settings.crypto_funding_watch_bybit_api_url or "").strip()
    if not url:
        return [], "missing-url"
    payload = ctx["http_json_get"](
        url,
        params={"category": "linear"},
        timeout=12,
        headers=_headers(settings.crypto_funding_watch_bybit_api_key, bybit=True),
    )
    result = payload.get("result") if isinstance(payload, dict) else None
    rows = result.get("list") if isinstance(result, dict) else []
    items = []
    for row in _filter_symbols((row for row in (rows or []) if isinstance(row, dict)), symbols):
        item = _normalize_item(
            exchange="Bybit",
            raw=row,
            symbol=row.get("symbol"),
            funding_rate=row.get("fundingRate"),
            mark_price=row.get("markPrice"),
            index_price=row.get("indexPrice"),
            next_funding_time=row.get("nextFundingTime"),
            updated_at=None,
        )
        if item is not None:
            items.append(item)
    return items, "ok" if items else "empty"


def get_crypto_funding_watch_snapshot(ctx: dict, limit: int = 16) -> Dict[str, Any]:
    settings = ctx["SETTINGS"]
    symbols = tuple(str(symbol).upper().strip() for symbol in settings.crypto_funding_watch_symbols if str(symbol).strip())
    symbol_set = set(symbols)
    ttl_seconds = max(10, int(settings.crypto_funding_watch_ttl_seconds or 15))
    cache_key = json.dumps(
        {
            "limit": limit,
            "symbols": symbols,
            "urlSet": _url_fingerprint(settings.crypto_funding_watch_api_url, settings.crypto_funding_watch_bybit_api_url),
            "version": 2,
        },
        sort_keys=True,
        ensure_ascii=True,
    )

    def _builder() -> Dict[str, Any]:
        source_status: Dict[str, str] = {}
        items: List[Dict[str, Any]] = []

        for source, fetcher in (("binance", _fetch_binance), ("bybit", _fetch_bybit)):
            try:
                source_items, status = fetcher(ctx, symbol_set)
                source_status[source] = status
                items.extend(source_items)
            except Exception:
                ctx["app"].logger.exception("crypto funding source failed source=%s", source)
                source_status[source] = "error"

        items.sort(
            key=lambda item: (
                float(item.get("abnormalScore") or 0),
                1 if item.get("tone") == "critical" else 0,
                str(item.get("asset") or ""),
            ),
            reverse=True,
        )
        venue_order, asset_rows, limited_items = _group_asset_rows(items, limit=limit)
        ok_sources = [status for status in source_status.values() if status == "ok"]
        if asset_rows and len(ok_sources) == len(source_status):
            status = "ok"
        elif asset_rows:
            status = "degraded"
        elif any(value == "missing-url" for value in source_status.values()):
            status = "degraded"
        elif all(value == "empty" for value in source_status.values()):
            status = "empty"
        else:
            status = "invalid"

        return {
            "generatedAt": ctx["utc_now_iso"](),
            "source": "binance/bybit-funding",
            "sourceUrl": str(settings.crypto_funding_watch_source_url or ""),
            "status": status,
            "sources": source_status,
            "venues": venue_order,
            "legend": {
                "positive": "longs pay shorts",
                "negative": "shorts pay longs",
            },
            "assets": asset_rows,
            "items": limited_items,
        }

    return ctx["get_snapshot_payload"](
        "snapshot:crypto:funding-watch",
        cache_key,
        _builder,
        ttl_seconds=ttl_seconds,
    )
