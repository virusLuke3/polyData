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
    score = abs(rate) * 10000
    if rate >= 0.0005:
        return "extreme positive", "critical", score
    if rate >= 0.0002:
        return "elevated positive", "warning", score
    if rate <= -0.0003:
        return "negative", "negative", score
    return "normal", "normal", score


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
    return {
        "id": f"{exchange.lower()}:{normalized_symbol}",
        "exchange": exchange,
        "symbol": normalized_symbol,
        "asset": asset,
        "pair": normalized_symbol,
        "fundingRate": rate,
        "fundingRatePercent": rate * 100,
        "annualizedPercent": rate * 3 * 365 * 100,
        "severity": severity,
        "tone": tone,
        "abnormalScore": score,
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
    ttl_seconds = max(15, int(settings.crypto_funding_watch_ttl_seconds or 60))
    cache_key = json.dumps(
        {
            "limit": limit,
            "symbols": symbols,
            "urlSet": _url_fingerprint(settings.crypto_funding_watch_api_url, settings.crypto_funding_watch_bybit_api_url),
            "version": 1,
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
        limited_items = items[:limit]
        ok_sources = [status for status in source_status.values() if status == "ok"]
        if limited_items and len(ok_sources) == len(source_status):
            status = "ok"
        elif limited_items:
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
            "items": limited_items,
        }

    return ctx["get_snapshot_payload"](
        "snapshot:crypto:funding-watch",
        cache_key,
        _builder,
        ttl_seconds=ttl_seconds,
    )
