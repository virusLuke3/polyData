from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode
from xml.etree import ElementTree

try:
    import requests
except ImportError:  # pragma: no cover - watcher validates dependency.
    requests = None

from api.services import crypto_funding_service, finance_external_sources_service


FINANCE_WATCH_CACHE_KEY = "v1"
FINANCE_WATCH_TTL_SECONDS = 10 * 60
FINANCE_WATCH_PANEL_IDS = (
    "defi-yield-monitor",
    "defi-security-watch",
    "crypto-perp-funding",
    "tradfi-perp-radar",
    "ipo-news-watch",
    "global-index-monitor",
    "crypto-fear-greed",
    "crypto-etf-flow",
    "stablecoin-monitor",
    "blockchain-policy-news",
)

DEFILLAMA_YIELDS_URL = "https://yields.llama.fi/pools"
ALTERNATIVE_FNG_URL = "https://api.alternative.me/fng/"
GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search"

GLOBAL_INDEX_SYMBOLS = (
    ("S&P 500", "^GSPC", "US"),
    ("NASDAQ", "^IXIC", "US"),
    ("DOW", "^DJI", "US"),
    ("RUSSELL", "^RUT", "US"),
    ("SHANGHAI", "000001.SS", "CN"),
    ("HANG SENG", "^HSI", "HK"),
    ("NIKKEI", "^N225", "JP"),
    ("NIFTY", "^NSEI", "IN"),
    ("EURO STOXX", "^STOXX50E", "EU"),
    ("FTSE", "^FTSE", "UK"),
    ("DAX", "^GDAXI", "DE"),
    ("CAC", "^FCHI", "FR"),
)

NEWS_QUERIES = {
    "defi-security-watch": '("DeFi" OR "crypto protocol") (exploit OR hack OR vulnerability OR attack OR audit OR governance risk)',
    "ipo-news-watch": 'IPO OR "S-1" OR "F-1" OR "files for listing" OR "public listing" OR "listing rumor"',
    "blockchain-policy-news": '("crypto bill" OR "stablecoin legislation" OR "SEC crypto" OR "CFTC crypto" OR "exchange enforcement" OR "tokenization regulation")',
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def finance_watch_namespace(panel_id: str) -> str:
    return f"runtime:finance:{panel_id}"


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _compact_source(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:34] if text else "source"


def _strip_html(value: Any) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _tone(value: Any, *, inverted: bool = False) -> str:
    number = _safe_float(value)
    if number is None:
        return "neutral"
    if inverted:
        number = -number
    if number > 0:
        return "up"
    if number < 0:
        return "down"
    return "neutral"


def _http_json_get(ctx: dict, url: str, *, params: Optional[Dict[str, Any]] = None, timeout: int = 12) -> Any:
    getter = ctx.get("http_json_get")
    if callable(getter):
        return getter(url, params=params, timeout=timeout, headers={"User-Agent": "polydata-finance-watch/1.0", "Accept": "application/json"})
    if requests is None:
        raise RuntimeError("requests package is required")
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.get(url, params=params, timeout=timeout, headers={"User-Agent": "polydata-finance-watch/1.0", "Accept": "application/json"})
        response.raise_for_status()
        return response.json() if response.content else None
    finally:
        session.close()


def _http_text_get(ctx: dict, url: str, *, timeout: int = 12) -> str:
    getter = ctx.get("http_text_get")
    if callable(getter):
        return getter(url, timeout=timeout, headers={"User-Agent": "polydata-finance-watch/1.0", "Accept": "application/rss+xml,application/xml,text/xml"})
    if requests is None:
        raise RuntimeError("requests package is required")
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.get(url, timeout=timeout, headers={"User-Agent": "polydata-finance-watch/1.0", "Accept": "application/rss+xml,application/xml,text/xml"})
        response.raise_for_status()
        return response.text
    finally:
        session.close()


def _news_url(query: str) -> str:
    return f"{GOOGLE_NEWS_RSS_URL}?{urlencode({'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})}"


def _parse_rss_items(xml_text: str, *, panel_id: str, limit: int) -> List[Dict[str, Any]]:
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        return []
    rows: List[Dict[str, Any]] = []
    for item in root.findall(".//item")[: max(1, limit * 2)]:
        title = _strip_html(item.findtext("title"))
        description = _strip_html(item.findtext("description"))
        source = _compact_source(item.findtext("source") or "Google News")
        link = item.findtext("link")
        published_raw = item.findtext("pubDate")
        published_at = None
        if published_raw:
            try:
                published_at = parsedate_to_datetime(published_raw).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            except (TypeError, ValueError):
                published_at = None
        tags = _news_tags(panel_id, title, description)
        rows.append(
            {
                "id": f"{panel_id}:{len(rows)}:{hash(title)}",
                "label": _headline_entity(title, source),
                "symbol": source.upper()[:14],
                "title": title,
                "summary": description,
                "source": source,
                "url": link,
                "publishedAt": published_at,
                "tags": tags,
                "tone": "down" if any(tag in {"HACK", "EXPLOIT", "ALERT", "ENFORCE"} for tag in tags) else "neutral",
            }
        )
        if len(rows) >= limit:
            break
    return rows


def _headline_entity(title: str, source: str) -> str:
    cleaned = re.split(r"\s[-|]\s", title or "")[0].strip()
    words = cleaned.split()
    if len(words) >= 2:
        return " ".join(words[:3])[:28]
    return cleaned[:28] or source


def _news_tags(panel_id: str, title: str, description: str) -> List[str]:
    text = f"{title} {description}".lower()
    pairs = (
        ("HACK", ("hack", "hacked", "drain")),
        ("EXPLOIT", ("exploit", "attack", "breach")),
        ("ALERT", ("vulnerability", "warning", "risk")),
        ("AUDIT", ("audit", "auditor")),
        ("S-1", ("s-1", "s1")),
        ("F-1", ("f-1", "f1")),
        ("IPO", ("ipo", "initial public")),
        ("LISTING", ("listing", "go public")),
        ("RUMOR", ("rumor", "reportedly")),
        ("BILL", ("bill", "legislation", "lawmakers")),
        ("SEC", ("sec", "securities and exchange")),
        ("CFTC", ("cftc",)),
        ("COURT", ("court", "judge", "lawsuit")),
        ("ENFORCE", ("enforcement", "charged", "settlement")),
        ("STABLE", ("stablecoin",)),
    )
    tags = [label for label, needles in pairs if any(needle in text for needle in needles)]
    if panel_id == "defi-security-watch":
        return (tags or ["ALERT"])[:3]
    if panel_id == "ipo-news-watch":
        return (tags or ["IPO"])[:3]
    return (tags or ["POLICY"])[:3]


def _read_finance_external(ctx: dict) -> Dict[str, Any]:
    payload = finance_external_sources_service.read_finance_external_sources(ctx)
    if isinstance(payload, dict) and payload:
        return payload
    try:
        return finance_external_sources_service.build_finance_external_sources_payload(ctx)
    except Exception:
        return {}


def _payload(panel_id: str, *, title: str, items: List[Dict[str, Any]], summary: Optional[Dict[str, Any]] = None, sources: Optional[Dict[str, Any]] = None, status: Optional[str] = None, generated_at: Optional[str] = None) -> Dict[str, Any]:
    return {
        "generatedAt": generated_at or utc_now_iso(),
        "status": status or ("ok" if items else "empty"),
        "cacheMode": "live-build",
        "panelId": panel_id,
        "title": title,
        "sources": sources or {},
        "summary": {"count": len(items), **(summary or {})},
        "items": items,
    }


def build_defi_yields_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    raw = _http_json_get(ctx, DEFILLAMA_YIELDS_URL, timeout=16)
    pools = raw.get("data") if isinstance(raw, dict) else []
    rows: List[Dict[str, Any]] = []
    for pool in pools or []:
        if not isinstance(pool, dict):
            continue
        tvl = _safe_float(pool.get("tvlUsd"))
        apy = _safe_float(pool.get("apy"))
        if tvl is None or apy is None or tvl < 1_000_000 or apy <= 0 or apy > 80:
            continue
        symbol = str(pool.get("symbol") or pool.get("underlyingTokens") or "").upper()
        project = str(pool.get("project") or "Protocol")
        tags = ["APY"]
        if pool.get("stablecoin"):
            tags.append("STABLE")
        if "ETH" in symbol:
            tags.append("ETH")
        if apy >= 20:
            tags.append("RISK")
        rows.append(
            {
                "id": str(pool.get("pool") or f"{project}:{symbol}"),
                "label": project.title(),
                "symbol": symbol[:18],
                "metric": apy,
                "metricLabel": f"{apy:.2f}%",
                "metricUnit": "APY",
                "secondary": tvl,
                "secondaryLabel": _format_usd(tvl),
                "change": _safe_float(pool.get("apyPct30D") or pool.get("apyPct7D")),
                "tags": tags[:4],
                "tone": "up" if apy < 25 else "watch",
            }
        )
    rows.sort(key=lambda item: (_safe_float(item.get("metric")) or 0.0), reverse=True)
    return _payload("defi-yield-monitor", title="DEFI YIELDS", items=rows[:limit], summary={"topLabel": rows[0]["label"] if rows else None}, sources={"defillamaYields": "ok" if rows else "empty"})


def build_news_payload(ctx: dict, panel_id: str, title: str, limit: int) -> Dict[str, Any]:
    query = NEWS_QUERIES[panel_id]
    xml_text = _http_text_get(ctx, _news_url(query), timeout=16)
    rows = _parse_rss_items(xml_text, panel_id=panel_id, limit=limit)
    return _payload(panel_id, title=title, items=rows, summary={"query": query}, sources={"googleNewsRss": "ok" if rows else "empty"})


def build_crypto_perps_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    base = crypto_funding_service.get_crypto_funding_watch_snapshot(ctx, limit=max(limit, 12))
    rows: List[Dict[str, Any]] = []
    for asset in (base.get("assets") or [])[:limit]:
        if not isinstance(asset, dict):
            continue
        funding = _safe_float(asset.get("maxAbsFundingPercent"))
        bias = str(asset.get("bias") or "mixed")
        signed = funding
        if funding is not None and bias == "shorts-pay":
            signed = -abs(funding)
        elif funding is not None:
            signed = abs(funding)
        rows.append(
            {
                "id": str(asset.get("symbol") or asset.get("asset")),
                "label": str(asset.get("asset") or asset.get("symbol") or "Perp"),
                "symbol": str(asset.get("symbol") or "").upper(),
                "metric": signed,
                "metricLabel": f"{signed:+.4f}%" if signed is not None else "--",
                "metricUnit": "FUND",
                "secondaryLabel": _short_time(asset.get("nextFundingTime")),
                "tags": [_bias_tag(bias), "RESET" if asset.get("nextFundingTime") else "PERP"],
                "tone": "down" if signed and signed < 0 else ("up" if signed and signed > 0 else "neutral"),
            }
        )
    return _payload("crypto-perp-funding", title="CRYPTO PERPS", items=rows, summary={"venues": len(base.get("venues") or [])}, sources=base.get("sources") if isinstance(base.get("sources"), dict) else {"funding": base.get("status") or "ok"})


def build_tradfi_perps_payload(ctx: dict, limit: int, external: Dict[str, Any]) -> Dict[str, Any]:
    source = external.get("tradfiPerps") if isinstance(external.get("tradfiPerps"), dict) else {}
    rows: List[Dict[str, Any]] = []
    for item in source.get("items") or []:
        if not isinstance(item, dict):
            continue
        mark = _safe_float(item.get("markPx"))
        oracle = _safe_float(item.get("oraclePx"))
        basis_bps = _safe_float(item.get("basisBps"))
        if basis_bps is None and mark is not None and oracle not in (None, 0):
            basis_bps = ((mark - float(oracle)) / float(oracle)) * 10000
        asset_class = str(item.get("assetClass") or "perp").upper()
        rows.append(
            {
                "id": str(item.get("symbol") or item.get("display")),
                "label": str(item.get("display") or f"{item.get('symbol')}-PERP"),
                "symbol": asset_class,
                "metric": mark,
                "metricLabel": _format_price(mark),
                "metricUnit": "MARK",
                "secondary": basis_bps,
                "secondaryLabel": f"{basis_bps:+.0f} bps" if basis_bps is not None else "--",
                "change": _safe_float(item.get("funding")),
                "tags": [asset_class, "BASIS" if basis_bps is not None else "PERP"],
                "tone": _tone(basis_bps),
            }
        )
    rows.sort(key=lambda item: abs(_safe_float(item.get("secondary")) or 0.0), reverse=True)
    return _payload("tradfi-perp-radar", title="TRADFI PERPS", items=rows[:limit], sources={"financeExternal": source.get("status") or "seed"})


def build_global_indices_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for label, symbol, region in GLOBAL_INDEX_SYMBOLS[:limit]:
        try:
            snapshot = ctx["get_yahoo_market_snapshot"](symbol, interval="30m", range_name="5d", ttl_seconds=300)
        except Exception:
            snapshot = None
        if not isinstance(snapshot, dict):
            continue
        change = _safe_float(snapshot.get("changePercent"))
        rows.append(
            {
                "id": symbol,
                "label": label,
                "symbol": region,
                "metric": snapshot.get("price"),
                "metricLabel": _format_price(snapshot.get("price")),
                "metricUnit": "IDX",
                "change": change,
                "changeLabel": f"{change:+.2f}%" if change is not None else "--",
                "points": snapshot.get("points") or [],
                "tags": [region],
                "tone": _tone(change),
            }
        )
    avg = sum(_safe_float(row.get("change")) or 0.0 for row in rows) / len(rows) if rows else None
    return _payload("global-index-monitor", title="GLOBAL INDICES", items=rows, summary={"riskTone": "RISK ON" if avg and avg > 0 else "RISK OFF" if avg and avg < 0 else "MIXED", "avgChange": avg}, sources={"yahoo": "ok" if rows else "empty"})


def build_fear_greed_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    raw = _http_json_get(ctx, ALTERNATIVE_FNG_URL, params={"limit": 1, "format": "json"}, timeout=12)
    data = (raw.get("data") or []) if isinstance(raw, dict) else []
    item = data[0] if data and isinstance(data[0], dict) else {}
    score = _safe_float(item.get("value"))
    label = str(item.get("value_classification") or "Neutral").upper()
    drivers = []
    for symbol in ("BTC-USD", "ETH-USD"):
        try:
            quote = ctx["get_yahoo_market_snapshot"](symbol, interval="5m", range_name="1d", ttl_seconds=60)
        except Exception:
            quote = None
        if isinstance(quote, dict):
            drivers.append(
                {
                    "id": symbol,
                    "label": symbol.replace("-USD", ""),
                    "symbol": "MOM",
                    "metricLabel": _format_price(quote.get("price")),
                    "change": quote.get("changePercent"),
                    "changeLabel": _format_pct(quote.get("changePercent")),
                    "tags": ["MOMENTUM"],
                    "tone": _tone(quote.get("changePercent")),
                }
            )
    payload = _payload("crypto-fear-greed", title="FEAR & GREED", items=drivers[:limit], summary={"score": score, "classification": label}, sources={"alternativeMe": "ok" if score is not None else "empty"}, status="ok" if score is not None else "empty")
    payload["headline"] = {"label": label, "score": score, "tone": "up" if score and score >= 55 else ("down" if score and score <= 45 else "neutral")}
    return payload


def build_crypto_etf_payload(ctx: dict, limit: int, external: Dict[str, Any]) -> Dict[str, Any]:
    source = external.get("etfFlow") if isinstance(external.get("etfFlow"), dict) else {}
    rows = []
    for item in source.get("items") or []:
        if not isinstance(item, dict):
            continue
        flow = _safe_float(item.get("flowProxyUsd"))
        change = _safe_float(item.get("changePercent"))
        symbol = str(item.get("symbol") or "ETF")
        rows.append(
            {
                "id": symbol,
                "label": symbol,
                "symbol": "BTC ETF" if symbol not in {"ETHA", "FETH"} else "ETH ETF",
                "metric": flow,
                "metricLabel": _format_usd(flow),
                "metricUnit": "FLOW",
                "change": change,
                "changeLabel": _format_pct(change),
                "tags": ["INFLOW" if flow and flow > 0 else "OUTFLOW" if flow and flow < 0 else "PROXY"],
                "tone": _tone(flow),
            }
        )
    return _payload("crypto-etf-flow", title="CRYPTO ETF", items=rows[:limit], summary={"netFlowProxyUsd": source.get("netFlowProxyUsd")}, sources={"financeExternal": source.get("status") or "seed"})


def build_stablecoin_payload(ctx: dict, limit: int, external: Dict[str, Any]) -> Dict[str, Any]:
    source = external.get("stablecoin") if isinstance(external.get("stablecoin"), dict) else {}
    rows = []
    for item in source.get("items") or []:
        if not isinstance(item, dict):
            continue
        deviation = _safe_float(item.get("deviationBps"))
        change = _safe_float(item.get("change7dPct"))
        rows.append(
            {
                "id": str(item.get("symbol") or item.get("name")),
                "label": str(item.get("symbol") or "Stablecoin"),
                "symbol": str(item.get("name") or "SUPPLY")[:18],
                "metric": item.get("price"),
                "metricLabel": _format_price(item.get("price"), digits=4),
                "metricUnit": "PEG",
                "secondary": item.get("supplyUsd"),
                "secondaryLabel": _format_usd(item.get("supplyUsd")),
                "change": change,
                "changeLabel": _format_pct(change),
                "tags": ["WATCH" if abs(deviation or 0.0) >= 20 else "OK", "SUPPLY"],
                "tone": "down" if abs(deviation or 0.0) >= 20 else _tone(change),
            }
        )
    return _payload("stablecoin-monitor", title="STABLECOINS", items=rows[:limit], summary={"totalSupplyUsd": source.get("totalSupplyUsd"), "supplyChange7dPct": source.get("supplyChange7dPct"), "stressedCount": source.get("stressedCount")}, sources={"financeExternal": source.get("status") or "seed"})


def build_finance_watch_panel_payload(ctx: dict, panel_id: str, limit: int = 10, external: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    limit = max(3, min(36, int(limit or 10)))
    if panel_id == "defi-yield-monitor":
        return build_defi_yields_payload(ctx, limit)
    if panel_id == "defi-security-watch":
        return build_news_payload(ctx, panel_id, "DEFI SECURITY", limit)
    if panel_id == "crypto-perp-funding":
        return build_crypto_perps_payload(ctx, limit)
    if panel_id == "tradfi-perp-radar":
        return build_tradfi_perps_payload(ctx, limit, external or _read_finance_external(ctx))
    if panel_id == "ipo-news-watch":
        return build_news_payload(ctx, panel_id, "IPO NEWS", limit)
    if panel_id == "global-index-monitor":
        return build_global_indices_payload(ctx, limit)
    if panel_id == "crypto-fear-greed":
        return build_fear_greed_payload(ctx, limit)
    if panel_id == "crypto-etf-flow":
        return build_crypto_etf_payload(ctx, limit, external or _read_finance_external(ctx))
    if panel_id == "stablecoin-monitor":
        return build_stablecoin_payload(ctx, limit, external or _read_finance_external(ctx))
    if panel_id == "blockchain-policy-news":
        return build_news_payload(ctx, panel_id, "CHAIN POLICY", limit)
    raise KeyError(f"unknown finance watch panel: {panel_id}")


def build_all_finance_watch_panel_payloads(ctx: dict, limit: int = 24) -> Dict[str, Dict[str, Any]]:
    external = _read_finance_external(ctx)
    payloads: Dict[str, Dict[str, Any]] = {}
    for panel_id in FINANCE_WATCH_PANEL_IDS:
        try:
            payloads[panel_id] = build_finance_watch_panel_payload(ctx, panel_id, limit=limit, external=external)
        except Exception as exc:
            payloads[panel_id] = _payload(panel_id, title=panel_id.upper(), items=[], status="error", sources={"builder": "error"}, summary={"error": str(exc)})
    return payloads


def _read_seeded_snapshot(ctx: dict, panel_id: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    namespace = finance_watch_namespace(panel_id)
    reader = ctx.get("get_cached_json")
    if callable(reader):
        redis_payload = reader(namespace, FINANCE_WATCH_CACHE_KEY)
        if isinstance(redis_payload, dict):
            ctx["SNAPSHOT_STORE"].set(namespace, FINANCE_WATCH_CACHE_KEY, redis_payload, ttl_seconds)
            return {**redis_payload, "cacheMode": str(redis_payload.get("cacheMode") or "redis-seed")}
    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is None:
        return None
    sqlite_payload = snapshot_store.get(namespace, FINANCE_WATCH_CACHE_KEY)
    if isinstance(sqlite_payload, dict):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(namespace, FINANCE_WATCH_CACHE_KEY, sqlite_payload, ttl_seconds)
        return {**sqlite_payload, "cacheMode": str(sqlite_payload.get("cacheMode") or "sqlite-seed")}
    stale_payload = snapshot_store.get_stale(namespace, FINANCE_WATCH_CACHE_KEY)
    if isinstance(stale_payload, dict):
        return {**stale_payload, "cacheMode": "stale-seed"}
    return None


def _trim_payload(payload: Dict[str, Any], limit: int) -> Dict[str, Any]:
    items = [item for item in (payload.get("items") or []) if isinstance(item, dict)]
    return {**payload, "items": items[: max(0, int(limit or 10))], "summary": {**(payload.get("summary") if isinstance(payload.get("summary"), dict) else {}), "count": min(len(items), max(0, int(limit or 10))), "totalCount": len(items)}}


def get_finance_watch_panel_snapshot(ctx: dict, panel_id: str, limit: int = 10) -> Dict[str, Any]:
    limit = max(3, min(36, int(limit or 10)))
    ttl_seconds = FINANCE_WATCH_TTL_SECONDS
    seeded = _read_seeded_snapshot(ctx, panel_id, ttl_seconds)
    if seeded is not None:
        return _trim_payload(seeded, limit)

    def _builder() -> Dict[str, Any]:
        return build_finance_watch_panel_payload(ctx, panel_id, limit=max(limit, 24))

    if "get_snapshot_payload" in ctx:
        payload = ctx["get_snapshot_payload"](finance_watch_namespace(panel_id), FINANCE_WATCH_CACHE_KEY, _builder, ttl_seconds=ttl_seconds)
    else:
        payload = _builder()
    return _trim_payload(payload if isinstance(payload, dict) else {}, limit)


def _format_usd(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "--"
    sign = "-" if number < 0 else ""
    number = abs(number)
    for suffix, divisor in (("T", 1_000_000_000_000), ("B", 1_000_000_000), ("M", 1_000_000), ("K", 1_000)):
        if number >= divisor:
            return f"{sign}${number / divisor:.1f}{suffix}"
    return f"{sign}${number:.0f}"


def _format_price(value: Any, digits: int = 2) -> str:
    number = _safe_float(value)
    if number is None:
        return "--"
    if abs(number) >= 1000:
        return f"{number:,.0f}"
    if abs(number) < 1:
        return f"{number:.4f}".rstrip("0").rstrip(".")
    return f"{number:,.{digits}f}".rstrip("0").rstrip(".")


def _format_pct(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "--"
    return f"{number:+.2f}%"


def _short_time(value: Any) -> str:
    if not value:
        return "--"
    try:
        timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return "--"
    delta = timestamp - datetime.now(timezone.utc)
    hours = int(delta.total_seconds() // 3600)
    if hours > 0:
        return f"{hours}h reset"
    minutes = int(delta.total_seconds() // 60)
    return f"{max(0, minutes)}m reset"


def _bias_tag(value: str) -> str:
    if value == "longs-pay":
        return "LONGS PAY"
    if value == "shorts-pay":
        return "SHORTS PAY"
    return "MIXED"
