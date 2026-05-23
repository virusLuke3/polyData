from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import requests
except ImportError:  # pragma: no cover - runtime watcher validates dependency.
    requests = None


FINANCE_EXTERNAL_NAMESPACE = "runtime:finance:external-sources"
FINANCE_EXTERNAL_CACHE_KEY = "v1"
FINANCE_EXTERNAL_TTL_SECONDS = 15 * 60

HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info"
DEFILLAMA_STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoins"
CFTC_LEGACY_COT_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"

ETF_FLOW_SYMBOLS: Tuple[Tuple[str, str], ...] = (
    ("IBIT", "iShares Bitcoin Trust"),
    ("FBTC", "Fidelity Wise Origin Bitcoin Fund"),
    ("GBTC", "Grayscale Bitcoin Trust"),
    ("BITB", "Bitwise Bitcoin ETF"),
    ("ARKB", "ARK 21Shares Bitcoin ETF"),
    ("ETHA", "iShares Ethereum Trust"),
)

TRADFI_PERP_SYMBOLS: Tuple[Tuple[str, str, str], ...] = (
    ("BTC", "Bitcoin", "crypto"),
    ("ETH", "Ethereum", "crypto"),
    ("SOL", "Solana", "crypto"),
    ("MSTR", "MicroStrategy", "stock"),
    ("COIN", "Coinbase", "stock"),
    ("HOOD", "Robinhood", "stock"),
    ("SPY", "S&P 500", "index"),
    ("QQQ", "Nasdaq 100", "index"),
)

COT_MARKETS: Tuple[Tuple[str, str, str], ...] = (
    ("ES", "E-MINI S&P 500", "Equity index"),
    ("NQ", "NASDAQ-100", "Equity index"),
    ("BTC", "BITCOIN", "Crypto"),
    ("CL", "CRUDE OIL", "Energy"),
    ("GC", "GOLD", "Metals"),
)

STABLECOIN_SYMBOLS: Tuple[str, ...] = ("USDT", "USDC", "USDS", "DAI", "PYUSD", "FDUSD", "TUSD")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _pct_change(current: Any, previous: Any) -> Optional[float]:
    current_float = _safe_float(current)
    previous_float = _safe_float(previous)
    if current_float is None or previous_float in (None, 0):
        return None
    return ((current_float - float(previous_float)) / float(previous_float)) * 100


def _nested_usd(row: Dict[str, Any], key: str) -> Optional[float]:
    payload = row.get(key)
    if not isinstance(payload, dict):
        return None
    return _safe_float(payload.get("peggedUSD"))


def _http_get(ctx: dict, url: str, *, params: Optional[Dict[str, Any]] = None, timeout: int = 12) -> Any:
    getter = ctx.get("http_json_get")
    if callable(getter):
        return getter(url, params=params, timeout=timeout, headers={"User-Agent": "polydata-finance-seed/1.0"})
    if requests is None:
        raise RuntimeError("requests package is required")
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.get(url, params=params, timeout=timeout, headers={"User-Agent": "polydata-finance-seed/1.0"})
        response.raise_for_status()
        return response.json() if response.content else None
    finally:
        session.close()


def _http_post(ctx: dict, url: str, *, json_payload: Dict[str, Any], timeout: int = 12) -> Any:
    poster = ctx.get("http_json_post")
    if callable(poster):
        return poster(url, json_payload=json_payload, timeout=timeout, headers={"User-Agent": "polydata-finance-seed/1.0"})
    if requests is None:
        raise RuntimeError("requests package is required")
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.post(url, json=json_payload, timeout=timeout, headers={"User-Agent": "polydata-finance-seed/1.0"})
        response.raise_for_status()
        return response.json() if response.content else None
    finally:
        session.close()


def read_finance_external_sources(ctx: dict) -> Dict[str, Any]:
    reader = ctx.get("get_cached_json")
    if callable(reader):
        payload = reader(FINANCE_EXTERNAL_NAMESPACE, FINANCE_EXTERNAL_CACHE_KEY)
        if isinstance(payload, dict):
            return payload
    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is not None:
        payload = snapshot_store.get_stale(FINANCE_EXTERNAL_NAMESPACE, FINANCE_EXTERNAL_CACHE_KEY)
        if isinstance(payload, dict):
            return payload
    return {}


def _source_status(items: Iterable[Any], *, degraded_if_empty: bool = True) -> str:
    count = len(list(items))
    if count:
        return "ok"
    return "degraded" if degraded_if_empty else "empty"


def fetch_hyperliquid_perp_source(ctx: dict) -> Dict[str, Any]:
    payload = _http_post(ctx, HYPERLIQUID_INFO_URL, json_payload={"type": "metaAndAssetCtxs"}, timeout=15)
    if not isinstance(payload, list) or len(payload) < 2:
        return {"status": "degraded", "items": [], "error": "unexpected Hyperliquid response"}
    universe = (payload[0] or {}).get("universe") or []
    asset_contexts = payload[1] or []
    wanted = {symbol for symbol, _name, _asset_class in TRADFI_PERP_SYMBOLS}
    rows: List[Dict[str, Any]] = []
    for meta, asset_ctx in zip(universe, asset_contexts):
        if not isinstance(meta, dict) or not isinstance(asset_ctx, dict):
            continue
        symbol = str(meta.get("name") or "").upper()
        if symbol not in wanted:
            continue
        rows.append(
            {
                "symbol": symbol,
                "display": f"{symbol}-PERP",
                "assetClass": next((asset_class for item_symbol, _name, asset_class in TRADFI_PERP_SYMBOLS if item_symbol == symbol), "crypto"),
                "markPx": _safe_float(asset_ctx.get("markPx")),
                "oraclePx": _safe_float(asset_ctx.get("oraclePx")),
                "spotPx": _safe_float(asset_ctx.get("midPx") or asset_ctx.get("markPx")),
                "basisBps": None,
                "funding": _safe_float(asset_ctx.get("funding")),
                "openInterest": _safe_float(asset_ctx.get("openInterest")),
                "dayNotional": _safe_float(asset_ctx.get("dayNtlVlm")),
                "source": "hyperliquid",
                "alerts": ["HYPER"],
            }
        )
    return {"status": _source_status(rows), "items": rows, "sourceUrl": HYPERLIQUID_INFO_URL}


def fetch_etf_flow_source(ctx: dict) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for symbol, issuer in ETF_FLOW_SYMBOLS:
        try:
            quote = ctx["get_yahoo_market_snapshot"](symbol, interval="30m", range_name="5d", ttl_seconds=300)
        except Exception:
            quote = None
        if not isinstance(quote, dict):
            continue
        change_pct = _safe_float(quote.get("changePercent"))
        volume = _safe_float(quote.get("volume24h"))
        price = _safe_float(quote.get("price"))
        flow_proxy = None
        if change_pct is not None and volume is not None and price is not None:
            flow_proxy = (change_pct / 100.0) * volume * price
        rows.append(
            {
                "symbol": symbol,
                "issuer": issuer,
                "price": price,
                "changePercent": change_pct,
                "volume": volume,
                "flowProxyUsd": flow_proxy,
                "source": "yahoo-flow-proxy",
            }
        )
    net_flow_proxy = sum(_safe_float(row.get("flowProxyUsd")) or 0.0 for row in rows)
    return {
        "status": _source_status(rows),
        "netFlowProxyUsd": net_flow_proxy,
        "items": sorted(rows, key=lambda item: abs(_safe_float(item.get("flowProxyUsd")) or 0.0), reverse=True),
        "sourceUrl": "https://query1.finance.yahoo.com/v8/finance/chart",
    }


def build_etf_flow_proxy_from_perps(hyperliquid_payload: Dict[str, Any]) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for item in hyperliquid_payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").upper()
        if symbol not in {"BTC", "ETH"}:
            continue
        funding = _safe_float(item.get("funding")) or 0.0
        day_notional = _safe_float(item.get("dayNotional")) or 0.0
        rows.append(
            {
                "symbol": f"{symbol}-ETF",
                "issuer": f"{symbol} ETF demand proxy",
                "price": item.get("markPx"),
                "changePercent": None,
                "volume": day_notional,
                "flowProxyUsd": funding * day_notional,
                "source": "hyperliquid-etf-proxy",
            }
        )
    net_flow_proxy = sum(_safe_float(row.get("flowProxyUsd")) or 0.0 for row in rows)
    return {
        "status": "proxy" if rows else "degraded",
        "netFlowProxyUsd": net_flow_proxy,
        "items": rows,
        "sourceUrl": HYPERLIQUID_INFO_URL,
        "note": "Yahoo ETF quotes unavailable; using BTC/ETH perp funding notional as an ETF demand proxy.",
    }


def fetch_cot_source(ctx: dict) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for symbol, query_term, asset_class in COT_MARKETS:
        try:
            payload = _http_get(
                ctx,
                CFTC_LEGACY_COT_URL,
                params={
                    "$limit": 1,
                    "$order": "report_date_as_yyyy_mm_dd DESC",
                    "$where": f"upper(market_and_exchange_names) like '%{query_term}%'",
                },
                timeout=15,
            )
        except Exception:
            payload = []
        row = payload[0] if isinstance(payload, list) and payload else {}
        if not isinstance(row, dict):
            continue
        noncomm_long = _safe_float(row.get("noncomm_positions_long_all"))
        noncomm_short = _safe_float(row.get("noncomm_positions_short_all"))
        open_interest = _safe_float(row.get("open_interest_all"))
        net = None
        net_pct_oi = None
        if noncomm_long is not None and noncomm_short is not None:
            net = noncomm_long - noncomm_short
            if open_interest not in (None, 0):
                net_pct_oi = (net / float(open_interest)) * 100
        rows.append(
            {
                "symbol": symbol,
                "assetClass": asset_class,
                "market": row.get("market_and_exchange_names"),
                "reportDate": row.get("report_date_as_yyyy_mm_dd"),
                "openInterest": open_interest,
                "nonCommercialLong": noncomm_long,
                "nonCommercialShort": noncomm_short,
                "nonCommercialNet": net,
                "netPctOpenInterest": net_pct_oi,
                "source": "cftc-cot",
            }
        )
    return {"status": _source_status(rows), "items": rows, "sourceUrl": CFTC_LEGACY_COT_URL}


def fetch_stablecoin_source(ctx: dict) -> Dict[str, Any]:
    payload = _http_get(ctx, DEFILLAMA_STABLECOINS_URL, params={"includePrices": "true"}, timeout=15)
    assets = payload.get("peggedAssets") if isinstance(payload, dict) else []
    rows: List[Dict[str, Any]] = []
    seen_symbols = set()
    for asset in assets or []:
        if not isinstance(asset, dict):
            continue
        symbol = str(asset.get("symbol") or "").upper()
        if symbol not in STABLECOIN_SYMBOLS:
            continue
        if symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)
        current = _nested_usd(asset, "circulating")
        prev_day = _nested_usd(asset, "circulatingPrevDay")
        prev_week = _nested_usd(asset, "circulatingPrevWeek")
        price = _safe_float(asset.get("price"))
        deviation_bps = None
        if price is not None:
            deviation_bps = (price - 1.0) * 10000
        rows.append(
            {
                "symbol": symbol,
                "name": asset.get("name"),
                "price": price,
                "deviationBps": deviation_bps,
                "supplyUsd": current,
                "change1dPct": _pct_change(current, prev_day),
                "change7dPct": _pct_change(current, prev_week),
                "pegMechanism": asset.get("pegMechanism"),
                "source": "defillama",
            }
        )
    rows.sort(key=lambda item: _safe_float(item.get("supplyUsd")) or 0.0, reverse=True)
    total_supply = sum(_safe_float(row.get("supplyUsd")) or 0.0 for row in rows)
    total_prev_week = None
    if rows:
        weighted = [
            (_safe_float(row.get("change7dPct")) or 0.0, _safe_float(row.get("supplyUsd")) or 0.0)
            for row in rows
        ]
        denominator = sum(weight for _change, weight in weighted)
        total_prev_week = sum(change * weight for change, weight in weighted) / denominator if denominator else None
    stressed = sum(1 for row in rows if abs(_safe_float(row.get("deviationBps")) or 0.0) >= 50)
    return {
        "status": _source_status(rows),
        "totalSupplyUsd": total_supply,
        "supplyChange7dPct": total_prev_week,
        "stressedCount": stressed,
        "items": rows,
        "sourceUrl": DEFILLAMA_STABLECOINS_URL,
    }


def build_finance_external_sources_payload(ctx: dict) -> Dict[str, Any]:
    sources: Dict[str, str] = {}
    errors: Dict[str, str] = {}

    def capture(name: str, builder) -> Dict[str, Any]:
        try:
            payload = builder(ctx)
            status = str(payload.get("status") or "unknown")
            sources[name] = status
            return payload
        except Exception as exc:
            sources[name] = "error"
            errors[name] = str(exc)
            return {"status": "error", "items": [], "error": str(exc)}

    hyperliquid = capture("hyperliquid", fetch_hyperliquid_perp_source)
    etf_flow = capture("etfFlow", fetch_etf_flow_source)
    if not (etf_flow.get("items") or []):
        etf_flow = build_etf_flow_proxy_from_perps(hyperliquid)
        sources["etfFlow"] = str(etf_flow.get("status") or "proxy")
    cot = capture("cot", fetch_cot_source)
    stablecoin = capture("stablecoin", fetch_stablecoin_source)
    # trade.xyz does not currently expose a documented public market-data endpoint
    # in the same way Hyperliquid does; keep a seeded source state so the panel can
    # distinguish "seeded proxy" from "seed pending".
    sources["tradexyz"] = "proxy" if hyperliquid.get("items") or etf_flow.get("items") else "degraded"

    ok_count = sum(1 for status in sources.values() if status in {"ok", "proxy"})
    status = "ok" if ok_count >= 3 and not errors else ("partial" if ok_count else "degraded")
    return {
        "generatedAt": utc_now_iso(),
        "status": status,
        "cacheMode": "seeded",
        "sources": sources,
        "errors": errors,
        "tradfiPerps": hyperliquid,
        "etfFlow": etf_flow,
        "cot": cot,
        "stablecoin": stablecoin,
        "summary": {
            "perpCount": len(hyperliquid.get("items") or []),
            "etfCount": len(etf_flow.get("items") or []),
            "cotCount": len(cot.get("items") or []),
            "stablecoinCount": len(stablecoin.get("items") or []),
            "stablecoinSupplyUsd": stablecoin.get("totalSupplyUsd"),
            "etfNetFlowProxyUsd": etf_flow.get("netFlowProxyUsd"),
        },
    }
