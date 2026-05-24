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


TECH_PANEL_CACHE_KEY = "v1"
TECH_PANEL_TTL_SECONDS = 10 * 60
TECH_PANEL_IDS = (
    "ai-model-race",
    "big-tech-market-cap",
    "consumer-app-pulse",
)

AI_ENTITIES = (
    ("OpenAI", "OPENAI", ("openai", "chatgpt", "gpt")),
    ("Anthropic", "ANTH", ("anthropic", "claude")),
    ("Google", "GOOGL", ("google", "gemini", "deepmind")),
    ("Meta", "META", ("meta", "llama")),
    ("xAI", "XAI", ("xai", "grok")),
    ("Mistral", "MISTRAL", ("mistral",)),
)

BIG_TECH_SYMBOLS = (
    ("NVIDIA", "NVDA", "AI"),
    ("Apple", "AAPL", "DEVICE"),
    ("Microsoft", "MSFT", "AI"),
    ("Alphabet", "GOOGL", "SEARCH"),
    ("Amazon", "AMZN", "CLOUD"),
    ("Meta", "META", "SOCIAL"),
    ("Tesla", "TSLA", "EV"),
    ("Broadcom", "AVGO", "CHIP"),
)

# Approximate shares outstanding used only when Yahoo chart metadata omits
# marketCap. This keeps the panel ranked by capitalization instead of falling
# back to plain price sorting.
BIG_TECH_SHARES_OUTSTANDING = {
    "NVDA": 24_300_000_000,
    "AAPL": 14_800_000_000,
    "MSFT": 7_430_000_000,
    "GOOGL": 12_100_000_000,
    "AMZN": 10_800_000_000,
    "META": 2_500_000_000,
    "TSLA": 3_230_000_000,
    "AVGO": 4_680_000_000,
}

APP_ENTITIES = (
    ("TikTok", "TIKTOK", ("tiktok",)),
    ("ChatGPT", "CHATGPT", ("chatgpt", "openai")),
    ("Instagram", "IG", ("instagram",)),
    ("YouTube", "YOUTUBE", ("youtube",)),
    ("Temu", "TEMU", ("temu",)),
    ("CapCut", "CAPCUT", ("capcut",)),
)

AI_NEWS_QUERY = (
    '("OpenAI" OR "Anthropic" OR "Google Gemini" OR "xAI Grok" OR "Meta Llama") '
    '("AI model" OR benchmark OR "model release" OR API OR outage OR valuation OR regulation) when:7d'
)
APP_NEWS_QUERY = (
    '("App Store" OR "Google Play" OR TikTok OR ChatGPT OR Instagram OR YouTube) '
    '(ranking OR downloads OR ban OR lawsuit OR regulation OR update) when:7d'
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def tech_panel_namespace(panel_id: str) -> str:
    return f"runtime:tech:{panel_id}"


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _strip_html(value: Any) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _compact_source(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:34] if text else "source"


def _format_price(value: Any, digits: int = 2) -> str:
    number = _safe_float(value)
    if number is None:
        return "--"
    if abs(number) >= 1000:
        return f"{number:,.0f}"
    return f"{number:,.{digits}f}"


def _format_pct(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "--"
    return f"{number:+.2f}%"


def _format_usd(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "--"
    sign = "-" if number < 0 else ""
    number = abs(number)
    for suffix, divisor in (("T", 1_000_000_000_000), ("B", 1_000_000_000), ("M", 1_000_000), ("K", 1_000)):
        if number >= divisor:
            return f"{sign}${number / divisor:.2f}{suffix}" if suffix == "T" else f"{sign}${number / divisor:.1f}{suffix}"
    return f"{sign}${number:.0f}"


def _tone(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "neutral"
    if number > 0:
        return "up"
    if number < 0:
        return "down"
    return "neutral"


def _payload(
    panel_id: str,
    *,
    title: str,
    items: List[Dict[str, Any]],
    summary: Optional[Dict[str, Any]] = None,
    sources: Optional[Dict[str, str]] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    source_states = dict(sources or {})
    has_ok_source = any(str(value).lower() == "ok" for value in source_states.values())
    resolved_status = status or ("ok" if items and has_ok_source else "partial" if items else "empty")
    return {
        "generatedAt": utc_now_iso(),
        "status": resolved_status,
        "panelId": panel_id,
        "title": title,
        "summary": dict(summary or {}),
        "sources": source_states,
        "items": items,
    }


def _http_text_get(ctx: dict, url: str, *, timeout: int = 12, headers: Optional[Dict[str, str]] = None) -> str:
    getter = ctx.get("http_text_get")
    if callable(getter):
        return getter(url, timeout=timeout, headers=headers)
    if requests is None:
        raise RuntimeError("requests package is required")
    response = requests.get(url, timeout=timeout, headers=headers)
    response.raise_for_status()
    return response.text


def _news_url(ctx: dict, query: str) -> str:
    settings = ctx.get("SETTINGS")
    base = str(
        getattr(settings, "tech_google_news_rss_url", "")
        or getattr(settings, "google_news_rss_url", "")
        or getattr(settings, "finance_google_news_rss_url", "")
        or "https://news.google.com/rss/search"
    ).rstrip("?")
    return f"{base}?{urlencode({'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})}"


def _parse_rss_items(xml_text: str, *, panel_id: str, limit: int) -> List[Dict[str, Any]]:
    root = ElementTree.fromstring(xml_text)
    rows: List[Dict[str, Any]] = []
    for item in root.findall(".//item"):
        title = _strip_html(item.findtext("title"))
        if not title:
            continue
        source = _strip_html(item.findtext("source")) or _compact_source(title.split(" - ")[-1] if " - " in title else "")
        clean_title = re.sub(r"\s+-\s+[^-]{2,48}$", "", title).strip() or title
        summary = _strip_html(item.findtext("description")) or clean_title
        published_at = None
        try:
            parsed = parsedate_to_datetime(item.findtext("pubDate") or "")
            if parsed:
                published_at = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        except Exception:
            published_at = None
        rows.append(
            {
                "id": item.findtext("guid") or item.findtext("link") or f"{panel_id}:{len(rows)}",
                "label": _detect_label(clean_title, panel_id),
                "symbol": _detect_symbol(clean_title, panel_id),
                "title": clean_title,
                "summary": summary,
                "source": source,
                "url": item.findtext("link"),
                "publishedAt": published_at,
                "metricLabel": _detect_event_label(clean_title),
                "secondaryLabel": source,
                "tags": _detect_tags(clean_title, panel_id),
                "tone": _detect_tone(clean_title),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def _detect_label(title: str, panel_id: str) -> str:
    haystack = title.lower()
    candidates = APP_ENTITIES if panel_id == "consumer-app-pulse" else AI_ENTITIES
    for label, _symbol, aliases in candidates:
        if any(alias in haystack for alias in aliases):
            return label
    return "TECH"


def _detect_symbol(title: str, panel_id: str) -> str:
    haystack = title.lower()
    candidates = APP_ENTITIES if panel_id == "consumer-app-pulse" else AI_ENTITIES
    for _label, symbol, aliases in candidates:
        if any(alias in haystack for alias in aliases):
            return symbol
    return "SIGNAL"


def _detect_event_label(title: str) -> str:
    haystack = title.lower()
    checks = (
        ("release", "RELEASE"),
        ("launch", "LAUNCH"),
        ("benchmark", "BENCH"),
        ("rank", "RANK"),
        ("price", "PRICE"),
        ("valuation", "VALUE"),
        ("funding", "VALUE"),
        ("outage", "OUTAGE"),
        ("ban", "BAN"),
        ("lawsuit", "LEGAL"),
        ("regulat", "REG"),
    )
    for needle, label in checks:
        if needle in haystack:
            return label
    return "WATCH"


def _detect_tags(title: str, panel_id: str) -> List[str]:
    haystack = title.lower()
    tags: List[str] = []
    for needle, tag in (
        ("benchmark", "BENCHMARK"),
        ("release", "RELEASE"),
        ("launch", "RELEASE"),
        ("api", "API"),
        ("pricing", "PRICING"),
        ("price", "PRICING"),
        ("valuation", "VALUATION"),
        ("funding", "VALUATION"),
        ("outage", "OUTAGE"),
        ("security", "RISK"),
        ("regulat", "REG"),
        ("lawsuit", "LEGAL"),
        ("ban", "BAN"),
        ("download", "DOWNLOAD"),
        ("ranking", "RANK"),
        ("rank", "RANK"),
    ):
        if needle in haystack and tag not in tags:
            tags.append(tag)
    if not tags:
        tags.append("AI" if panel_id == "ai-model-race" else "APP")
    return tags[:4]


def _detect_tone(title: str) -> str:
    haystack = title.lower()
    if any(word in haystack for word in ("outage", "lawsuit", "ban", "delay", "probe", "investigation", "risk")):
        return "down"
    if any(word in haystack for word in ("release", "launch", "raise", "record", "tops", "surge", "growth")):
        return "up"
    if any(word in haystack for word in ("regulat", "valuation", "benchmark", "ranking", "rank")):
        return "watch"
    return "neutral"


def _entity_summary(rows: List[Dict[str, Any]], entities: tuple) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {label: 0 for label, _symbol, _aliases in entities}
    tones: Dict[str, str] = {label: "neutral" for label, _symbol, _aliases in entities}
    latest: Dict[str, str] = {}
    for row in rows:
        label = str(row.get("label") or "")
        if label not in counts:
            continue
        counts[label] += 1
        if label not in latest and row.get("title"):
            latest[label] = str(row.get("title"))
        if row.get("tone") in {"up", "down", "watch"}:
            tones[label] = str(row.get("tone"))
    summary_rows = []
    for label, symbol, _aliases in entities:
        summary_rows.append({"label": label, "symbol": symbol, "count": counts[label], "tone": tones[label], "latest": latest.get(label)})
    summary_rows.sort(key=lambda item: (int(item.get("count") or 0), str(item.get("label"))), reverse=True)
    return summary_rows


def build_ai_model_race_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    sources = {"googleNewsRss": "empty"}
    error_summary = None
    try:
        rows = _parse_rss_items(_http_text_get(ctx, _news_url(ctx, AI_NEWS_QUERY), timeout=14), panel_id="ai-model-race", limit=limit)
        sources["googleNewsRss"] = "ok" if rows else "empty"
    except Exception as exc:
        rows = []
        error_summary = str(exc)
        sources["googleNewsRss"] = "error"
    summary_rows = _entity_summary(rows, AI_ENTITIES)
    return _payload(
        "ai-model-race",
        title="AI MODEL RACE",
        items=rows[:limit],
        summary={"watchlist": summary_rows, "query": AI_NEWS_QUERY, "error": error_summary},
        sources=sources,
    )


def _fetch_quote(ctx: dict, symbol: str) -> Optional[Dict[str, Any]]:
    getter = ctx.get("get_yahoo_market_snapshot")
    if not callable(getter):
        return None
    try:
        return getter(symbol, interval="30m", range_name="5d", ttl_seconds=300)
    except Exception:
        logger = getattr(ctx.get("app"), "logger", None)
        if logger:
            logger.exception("tech quote fetch failed symbol=%s", symbol)
        return None


def _market_cap_from_quote(symbol: str, quote: Dict[str, Any]) -> tuple[Optional[float], bool]:
    market_cap = _safe_float(quote.get("marketCap"))
    if market_cap is not None:
        return market_cap, False
    price = _safe_float(quote.get("price"))
    shares = BIG_TECH_SHARES_OUTSTANDING.get(symbol)
    if price is None or not shares:
        return None, False
    return price * shares, True


def build_big_tech_market_cap_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for label, symbol, group in BIG_TECH_SYMBOLS:
        quote = _fetch_quote(ctx, symbol)
        if not isinstance(quote, dict):
            continue
        change = _safe_float(quote.get("changePercent"))
        market_cap, estimated_cap = _market_cap_from_quote(symbol, quote)
        rows.append(
            {
                "id": symbol,
                "label": label,
                "symbol": symbol,
                "title": f"{label} market cap rank watch",
                "metric": market_cap if market_cap is not None else quote.get("price"),
                "metricLabel": _format_usd(market_cap) if market_cap is not None else _format_price(quote.get("price")),
                "metricUnit": "MKT CAP" if market_cap is not None else "PRICE",
                "secondary": quote.get("price"),
                "secondaryLabel": _format_price(quote.get("price")),
                "change": change,
                "changeLabel": _format_pct(change),
                "tags": [group, "MEGA"],
                "tone": _tone(change),
                "points": quote.get("points") or [],
                "marketCap": market_cap,
                "marketCapEstimated": estimated_cap,
                "price": quote.get("price"),
            }
        )
    rows.sort(key=lambda item: (_safe_float(item.get("marketCap")) is not None, _safe_float(item.get("marketCap")) or 0), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
        row["title"] = f"#{index} {row['label']} mega-cap watch"
    avg = sum(_safe_float(row.get("change")) or 0.0 for row in rows) / len(rows) if rows else None
    return _payload(
        "big-tech-market-cap",
        title="BIG TECH CAP",
        items=rows[:limit],
        summary={"avgChange": avg, "rankBy": "marketCap", "tracked": len(BIG_TECH_SYMBOLS)},
        sources={"yahoo": "ok" if rows else "empty"},
    )


def _fetch_app_store_rows(ctx: dict, limit: int) -> List[Dict[str, Any]]:
    settings = ctx.get("SETTINGS")
    url = str(getattr(settings, "tech_app_store_top_free_url", "") or "").strip()
    getter = ctx.get("http_json_get")
    if not url or not callable(getter):
        return []
    payload = getter(url, timeout=12, headers={"User-Agent": "polydata-tech-panels/1.0", "Accept": "application/json"})
    entries = (((payload or {}).get("feed") or {}).get("results") or []) if isinstance(payload, dict) else []
    rows: List[Dict[str, Any]] = []
    for index, app in enumerate(entries[:limit], start=1):
        if not isinstance(app, dict):
            continue
        name = str(app.get("name") or app.get("artistName") or "App").strip()
        artist = str(app.get("artistName") or "").strip()
        rows.append(
            {
                "id": str(app.get("id") or f"app-store-{index}"),
                "label": name,
                "symbol": "IOS",
                "title": f"#{index} {name}",
                "summary": artist,
                "source": "App Store",
                "url": app.get("url"),
                "metric": index,
                "metricLabel": f"#{index}",
                "metricUnit": "RANK",
                "secondaryLabel": artist[:28] if artist else "TOP FREE",
                "tags": ["APP STORE", "TOP FREE"],
                "tone": "up" if index <= 5 else "neutral",
            }
        )
    return rows


def build_consumer_app_pulse_payload(ctx: dict, limit: int) -> Dict[str, Any]:
    sources = {"appStore": "empty", "googleNewsRss": "empty"}
    try:
        app_rows = _fetch_app_store_rows(ctx, max(limit, 12))
        sources["appStore"] = "ok" if app_rows else "empty"
    except Exception as exc:
        app_rows = []
        app_error = str(exc)
        sources["appStore"] = "error"
    news_limit = max(3, limit - min(len(app_rows), max(4, limit // 2)))
    try:
        news_rows = _parse_rss_items(_http_text_get(ctx, _news_url(ctx, APP_NEWS_QUERY), timeout=14), panel_id="consumer-app-pulse", limit=news_limit)
        sources["googleNewsRss"] = "ok" if news_rows else "empty"
    except Exception as exc:
        news_rows = []
        news_error = str(exc)
        sources["googleNewsRss"] = "error"
    rows = (app_rows[: max(4, limit // 2)] + news_rows)[:limit]
    summary_rows = _entity_summary(news_rows, APP_ENTITIES)
    return _payload(
        "consumer-app-pulse",
        title="APP PULSE",
        items=rows,
        summary={
            "watchlist": summary_rows,
            "query": APP_NEWS_QUERY,
            "appStoreRows": len(app_rows),
            "newsRows": len(news_rows),
            "appStoreError": locals().get("app_error"),
            "newsError": locals().get("news_error"),
        },
        sources=sources,
    )


def build_tech_panel_payload(ctx: dict, panel_id: str, limit: int = 10) -> Dict[str, Any]:
    limit = max(3, min(36, int(limit or 10)))
    if panel_id == "ai-model-race":
        return build_ai_model_race_payload(ctx, limit)
    if panel_id == "big-tech-market-cap":
        return build_big_tech_market_cap_payload(ctx, limit)
    if panel_id == "consumer-app-pulse":
        return build_consumer_app_pulse_payload(ctx, limit)
    raise KeyError(f"unknown tech panel: {panel_id}")


def build_all_tech_panel_payloads(ctx: dict, limit: int = 24) -> Dict[str, Dict[str, Any]]:
    payloads: Dict[str, Dict[str, Any]] = {}
    for panel_id in TECH_PANEL_IDS:
        try:
            payloads[panel_id] = build_tech_panel_payload(ctx, panel_id, limit=limit)
        except Exception as exc:
            payloads[panel_id] = _payload(panel_id, title=panel_id.upper(), items=[], status="error", sources={"builder": "error"}, summary={"error": str(exc)})
    return payloads


def _read_seeded_snapshot(ctx: dict, panel_id: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    def usable(payload: Dict[str, Any]) -> bool:
        if str(payload.get("status") or "").lower() == "error" and not payload.get("items"):
            return False
        return True

    namespace = tech_panel_namespace(panel_id)
    reader = ctx.get("get_cached_json")
    if callable(reader):
        redis_payload = reader(namespace, TECH_PANEL_CACHE_KEY)
        if isinstance(redis_payload, dict) and usable(redis_payload):
            ctx["SNAPSHOT_STORE"].set(namespace, TECH_PANEL_CACHE_KEY, redis_payload, ttl_seconds)
            return {**redis_payload, "cacheMode": str(redis_payload.get("cacheMode") or "redis-seed")}
    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is None:
        return None
    sqlite_payload = snapshot_store.get(namespace, TECH_PANEL_CACHE_KEY)
    if isinstance(sqlite_payload, dict) and usable(sqlite_payload):
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(namespace, TECH_PANEL_CACHE_KEY, sqlite_payload, ttl_seconds)
        return {**sqlite_payload, "cacheMode": str(sqlite_payload.get("cacheMode") or "sqlite-seed")}
    stale_payload = snapshot_store.get_stale(namespace, TECH_PANEL_CACHE_KEY)
    if isinstance(stale_payload, dict) and usable(stale_payload):
        return {**stale_payload, "cacheMode": "stale-seed"}
    return None


def _trim_payload(payload: Dict[str, Any], limit: int) -> Dict[str, Any]:
    items = [item for item in (payload.get("items") or []) if isinstance(item, dict)]
    limit = max(0, int(limit or 10))
    return {
        **payload,
        "items": items[:limit],
        "summary": {
            **(payload.get("summary") if isinstance(payload.get("summary"), dict) else {}),
            "count": min(len(items), limit),
            "totalCount": len(items),
        },
    }


def get_tech_panel_snapshot(ctx: dict, panel_id: str, limit: int = 10) -> Dict[str, Any]:
    limit = max(3, min(36, int(limit or 10)))
    settings = ctx.get("SETTINGS")
    ttl_seconds = int(getattr(settings, "tech_runtime_ttl_seconds", TECH_PANEL_TTL_SECONDS) or TECH_PANEL_TTL_SECONDS)
    seeded = _read_seeded_snapshot(ctx, panel_id, ttl_seconds)
    if seeded is not None:
        return _trim_payload(seeded, limit)

    def _builder() -> Dict[str, Any]:
        return build_tech_panel_payload(ctx, panel_id, limit=max(limit, 24))

    if "get_snapshot_payload" in ctx:
        payload = ctx["get_snapshot_payload"](tech_panel_namespace(panel_id), TECH_PANEL_CACHE_KEY, _builder, ttl_seconds=ttl_seconds)
    else:
        payload = _builder()
    return _trim_payload(payload if isinstance(payload, dict) else {}, limit)
