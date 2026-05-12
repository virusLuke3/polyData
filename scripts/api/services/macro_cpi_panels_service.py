from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


SNAPSHOT_NAMESPACE_PREFIX = "snapshot:macro:"
DEFAULT_ITEM_LIMIT = 8
DEFAULT_TTL_SECONDS = 21600
FRED_SOURCE = "FRED CSV / public macro series"
CACHE_KEY = "panel-v2"


PANEL_CONFIGS: Dict[str, Dict[str, Any]] = {
    "supply-tariff-import-watch": {
        "source": "FRED CSV / Federal Register trade policy",
        "sourceUrl": "https://fred.stlouisfed.org/",
        "signalHot": "SUPPLY / TARIFF PRESSURE",
        "signalCool": "SUPPLY CHAIN EASING",
        "signalNeutral": "IMPORT WATCH MIXED",
        "linkedMarketCategories": ["cpi", "fed", "growth"],
        "series": [
            {"key": "ppi_all", "seriesId": "PPIACO", "label": "Producer prices all commodities", "group": "Upstream", "icon": "source", "unit": "idx", "metric": "pct", "toneUp": "hot"},
            {"key": "imports", "seriesId": "IMPGS", "label": "Imports of goods & services", "group": "Imports", "icon": "market", "unit": "bil", "metric": "pct", "toneUp": "cool"},
            {"key": "export_import", "seriesId": "EXPGS", "label": "Exports of goods & services", "group": "Trade", "icon": "growth", "unit": "bil", "metric": "pct", "toneUp": "cool"},
        ],
        "federalRegisterQuery": "tariff import duty trade",
    },
    "shelter-rent-oer-pressure": {
        "source": "FRED CSV / BLS shelter CPI",
        "sourceUrl": "https://fred.stlouisfed.org/",
        "signalHot": "SHELTER CPI STICKY",
        "signalCool": "SHELTER DISINFLATION",
        "signalNeutral": "SHELTER WATCH",
        "linkedMarketCategories": ["cpi", "fed"],
        "series": [
            {"key": "rent", "seriesId": "CUSR0000SEHA", "label": "Rent of primary residence", "group": "Rent", "icon": "home", "unit": "idx", "metric": "pct", "toneUp": "hot"},
            {"key": "oer", "seriesId": "CUSR0000SEHC", "label": "Owners equivalent rent", "group": "OER", "icon": "home", "unit": "idx", "metric": "pct", "toneUp": "hot"},
            {"key": "shelter", "seriesId": "CUSR0000SAH1", "label": "Shelter CPI", "group": "Shelter", "icon": "cpi", "unit": "idx", "metric": "pct", "toneUp": "hot"},
            {"key": "home_prices", "seriesId": "CSUSHPINSA", "label": "Case-Shiller home prices", "group": "Housing", "icon": "market", "unit": "idx", "metric": "pct", "toneUp": "hot"},
        ],
    },
    "labor-wage-services-pressure": {
        "source": "FRED CSV / BLS labor indicators",
        "sourceUrl": "https://fred.stlouisfed.org/",
        "signalHot": "WAGE / SERVICES HOT",
        "signalCool": "LABOR COOLING",
        "signalNeutral": "LABOR MIXED",
        "linkedMarketCategories": ["labor", "cpi", "fed"],
        "series": [
            {"key": "payrolls", "seriesId": "PAYEMS", "label": "Nonfarm payrolls", "group": "Jobs", "icon": "labor", "unit": "k", "metric": "delta", "toneUp": "hot"},
            {"key": "unrate", "seriesId": "UNRATE", "label": "Unemployment rate", "group": "Slack", "icon": "labor", "unit": "%", "metric": "level", "toneUp": "cool"},
            {"key": "wages", "seriesId": "CES0500000003", "label": "Avg hourly earnings", "group": "Wages", "icon": "fed", "unit": "$", "metric": "pct", "toneUp": "hot"},
            {"key": "claims", "seriesId": "ICSA", "label": "Initial jobless claims", "group": "Claims", "icon": "source", "unit": "k", "metric": "delta", "toneUp": "cool"},
            {"key": "openings", "seriesId": "JTSJOL", "label": "Job openings", "group": "JOLTS", "icon": "market", "unit": "k", "metric": "delta", "toneUp": "hot"},
        ],
    },
    "growth-demand-recession-tracker": {
        "source": "FRED CSV / growth and curve signals",
        "sourceUrl": "https://fred.stlouisfed.org/",
        "signalHot": "DEMAND STILL FIRM",
        "signalCool": "RECESSION PRESSURE",
        "signalNeutral": "GROWTH MIXED",
        "linkedMarketCategories": ["growth", "fed", "cpi"],
        "series": [
            {"key": "retail", "seriesId": "RSAFS", "label": "Retail sales", "group": "Demand", "icon": "basket", "unit": "mil", "metric": "pct", "toneUp": "hot"},
            {"key": "pce", "seriesId": "PCE", "label": "Personal consumption", "group": "Demand", "icon": "cpi", "unit": "bil", "metric": "pct", "toneUp": "hot"},
            {"key": "industrial", "seriesId": "INDPRO", "label": "Industrial production", "group": "Output", "icon": "growth", "unit": "idx", "metric": "pct", "toneUp": "hot"},
            {"key": "gdp", "seriesId": "GDPC1", "label": "Real GDP", "group": "GDP", "icon": "growth", "unit": "bil", "metric": "pct", "toneUp": "hot"},
            {"key": "curve", "seriesId": "T10Y2Y", "label": "10Y minus 2Y Treasury", "group": "Curve", "icon": "rates", "unit": "pp", "metric": "level", "toneUp": "hot"},
        ],
    },
    "fed-rates-polymarket-gap": {
        "source": "FRED CSV / Fed and Treasury rates",
        "sourceUrl": "https://fred.stlouisfed.org/",
        "signalHot": "RATES HAWKISH GAP",
        "signalCool": "CUT PATH EASING",
        "signalNeutral": "FED GAP WATCH",
        "linkedMarketCategories": ["fed", "cpi", "growth"],
        "series": [
            {"key": "dff", "seriesId": "DFF", "label": "Effective Fed funds", "group": "Fed", "icon": "fed", "unit": "%", "metric": "level", "toneUp": "hot"},
            {"key": "sofr", "seriesId": "SOFR", "label": "SOFR", "group": "Money", "icon": "rates", "unit": "%", "metric": "level", "toneUp": "hot"},
            {"key": "two_year", "seriesId": "DGS2", "label": "2Y Treasury", "group": "Front-end", "icon": "rates", "unit": "%", "metric": "level", "toneUp": "hot"},
            {"key": "ten_year", "seriesId": "DGS10", "label": "10Y Treasury", "group": "Long-end", "icon": "market", "unit": "%", "metric": "level", "toneUp": "hot"},
            {"key": "curve", "seriesId": "T10Y2Y", "label": "10Y / 2Y curve", "group": "Curve", "icon": "growth", "unit": "pp", "metric": "level", "toneUp": "cool"},
        ],
    },
}


def _utc_now_iso(ctx: dict) -> str:
    now = ctx.get("utc_now_iso")
    return now() if callable(now) else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _float(value: Any) -> Optional[float]:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def _snapshot_namespace(panel_id: str) -> str:
    return f"{SNAPSHOT_NAMESPACE_PREFIX}{panel_id}"


def _fred_url(ctx: dict, series_id: str) -> str:
    template = getattr(ctx["SETTINGS"], "food_basket_fred_csv_url_template", "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    return str(template).format(series_id=series_id)


def _fetch_fred_series(ctx: dict, spec: Dict[str, Any]) -> Dict[str, Any]:
    series_id = spec["seriesId"]
    url = _fred_url(ctx, series_id)
    text = ctx["http_text_get"](url, timeout=15, headers={"User-Agent": "polydata-macro-cpi-panels/1.0"})
    rows: List[Dict[str, Any]] = []
    reader = csv.DictReader(io.StringIO(str(text or "")))
    for row in reader:
        value = _float(row.get(series_id))
        date = str(row.get("observation_date") or "").strip()
        if value is None or not date:
            continue
        rows.append({"date": date, "value": value})
    rows.sort(key=lambda item: item["date"])
    if len(rows) < 2:
        raise ValueError(f"not enough observations for {series_id}")
    latest = rows[-1]
    prev = rows[-2]
    year_ago = rows[-13] if len(rows) >= 13 else rows[0]
    change = latest["value"] - prev["value"]
    change_pct = None
    if prev["value"]:
        change_pct = (latest["value"] / prev["value"] - 1.0) * 100.0
    yoy_pct = None
    if year_ago["value"]:
        yoy_pct = (latest["value"] / year_ago["value"] - 1.0) * 100.0
    tone = _series_tone(spec, change, change_pct, latest["value"])
    return {
        "key": spec["key"],
        "seriesId": series_id,
        "label": spec["label"],
        "group": spec.get("group") or spec["key"],
        "icon": spec.get("icon") or "source",
        "metric": spec.get("metric") or "level",
        "unit": spec.get("unit"),
        "date": latest["date"],
        "value": round(latest["value"], 3),
        "change": round(change, 3),
        "changePct": round(change_pct, 2) if change_pct is not None else None,
        "yoyPct": round(yoy_pct, 2) if yoy_pct is not None else None,
        "tone": tone,
        "source": FRED_SOURCE,
        "sourceUrl": url,
    }


def _series_tone(spec: Dict[str, Any], change: float, change_pct: Optional[float], latest: float) -> str:
    metric = str(spec.get("metric") or "level")
    driver = change if metric in {"delta", "level"} else (change_pct if change_pct is not None else change)
    if metric == "level" and str(spec.get("key")) in {"gscpi", "curve"}:
        driver = latest
    if abs(driver) < 0.05:
        return "neutral"
    up_tone = str(spec.get("toneUp") or "hot")
    if driver > 0:
        return up_tone if up_tone in {"hot", "cool", "watch", "neutral"} else "hot"
    return "cool" if up_tone == "hot" else "hot"


def _fetch_federal_register_items(ctx: dict, panel_id: str, config: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    query = config.get("federalRegisterQuery")
    if not query:
        return []
    url = getattr(ctx["SETTINGS"], "geo_shock_federal_register_api_url", "https://www.federalregister.gov/api/v1/documents.json")
    payload = ctx["http_json_get"](
        url,
        params={"conditions[term]": query, "order": "newest", "per_page": min(5, max(1, limit))},
        timeout=12,
        headers={"Accept": "application/json", "User-Agent": "polydata-macro-cpi-panels/1.0"},
    )
    docs = (payload or {}).get("results") if isinstance(payload, dict) else []
    items: List[Dict[str, Any]] = []
    for index, doc in enumerate(docs or []):
        if not isinstance(doc, dict):
            continue
        title = str(doc.get("title") or "Federal Register trade policy").strip()
        items.append(
            {
                "key": f"federal-register-{index}",
                "seriesId": None,
                "label": title,
                "group": "Policy",
                "icon": "policy",
                "metric": "event",
                "unit": None,
                "date": doc.get("publication_date"),
                "value": None,
                "change": None,
                "changePct": None,
                "yoyPct": None,
                "tone": "watch",
                "source": "Federal Register",
                "sourceUrl": doc.get("html_url") or doc.get("pdf_url") or url,
            }
        )
    return items


def _summary(panel_id: str, config: Dict[str, Any], items: List[Dict[str, Any]], sources: Dict[str, str]) -> Dict[str, Any]:
    scored = [item for item in items if item.get("tone") in {"hot", "cool", "watch", "neutral"}]
    hot = sum(1 for item in scored if item.get("tone") == "hot")
    cool = sum(1 for item in scored if item.get("tone") == "cool")
    watch = sum(1 for item in scored if item.get("tone") == "watch")
    if hot > cool:
        signal = config["signalHot"]
        bias = "hot"
    elif cool > hot:
        signal = config["signalCool"]
        bias = "cool"
    elif watch:
        signal = config["signalNeutral"]
        bias = "watch"
    else:
        signal = config["signalNeutral"]
        bias = "neutral"
    top = None
    numeric_items = [item for item in items if _float(item.get("changePct")) is not None or _float(item.get("change")) is not None]
    if numeric_items:
        top = max(numeric_items, key=lambda item: abs(_float(item.get("changePct")) if _float(item.get("changePct")) is not None else _float(item.get("change")) or 0.0))
    return {
        "signal": signal,
        "bias": bias,
        "hotCount": hot,
        "coolCount": cool,
        "watchCount": watch,
        "coverage": sum(1 for value in sources.values() if value == "ok"),
        "sourceCount": len(sources),
        "topMover": top,
        "linkedMarketCategories": config.get("linkedMarketCategories") or [],
        "panelId": panel_id,
    }


def build_macro_cpi_panel_payload(ctx: dict, panel_id: str, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    config = PANEL_CONFIGS[panel_id]
    items: List[Dict[str, Any]] = []
    sources: Dict[str, str] = {}
    for spec in config.get("series") or []:
        key = str(spec.get("key") or spec.get("seriesId"))
        try:
            items.append(_fetch_fred_series(ctx, spec))
            sources[key] = "ok"
        except Exception as exc:
            sources[key] = "error"
            logger = getattr(ctx.get("app"), "logger", None)
            if logger is not None:
                logger.exception("macro cpi panel source failed panel=%s source=%s error=%s", panel_id, key, exc)
    if config.get("federalRegisterQuery"):
        try:
            policy_items = _fetch_federal_register_items(ctx, panel_id, config, limit)
            items.extend(policy_items)
            sources["federal_register"] = "ok" if policy_items else "empty"
        except Exception as exc:
            sources["federal_register"] = "error"
            logger = getattr(ctx.get("app"), "logger", None)
            if logger is not None:
                logger.exception("macro cpi panel federal register failed panel=%s error=%s", panel_id, exc)
    status = "ok" if sources and all(value in {"ok", "empty"} for value in sources.values()) else ("degraded" if items else "warming")
    limited_items = items[: max(1, min(int(limit or DEFAULT_ITEM_LIMIT), 12))]
    return {
        "generatedAt": _utc_now_iso(ctx),
        "source": config.get("source") or FRED_SOURCE,
        "sourceUrl": config.get("sourceUrl") or "https://fred.stlouisfed.org/",
        "status": status,
        "sources": sources,
        "summary": _summary(panel_id, config, limited_items, sources),
        "items": limited_items,
    }


def _empty(ctx: dict, panel_id: str, status: str = "warming") -> Dict[str, Any]:
    config = PANEL_CONFIGS[panel_id]
    return {
        "generatedAt": _utc_now_iso(ctx),
        "source": config.get("source") or FRED_SOURCE,
        "sourceUrl": config.get("sourceUrl") or "https://fred.stlouisfed.org/",
        "status": status,
        "sources": {},
        "summary": _summary(panel_id, config, [], {}),
        "items": [],
    }


def normalize_macro_cpi_panel_payload(payload: Any, *, ctx: dict, panel_id: str, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return _empty(ctx, panel_id, "invalid")
    result = json.loads(json.dumps(payload, ensure_ascii=True, default=str))
    config = PANEL_CONFIGS[panel_id]
    items = [item for item in (result.get("items") or []) if isinstance(item, dict)]
    result["items"] = items[: max(1, min(int(limit or DEFAULT_ITEM_LIMIT), 12))]
    result["summary"] = result.get("summary") if isinstance(result.get("summary"), dict) else _summary(panel_id, config, result["items"], result.get("sources") or {})
    result["generatedAt"] = str(result.get("generatedAt") or _utc_now_iso(ctx))
    result["status"] = str(result.get("status") or ("ok" if result["items"] else "warming"))
    result["source"] = str(result.get("source") or config.get("source") or FRED_SOURCE)
    result["sourceUrl"] = str(result.get("sourceUrl") or config.get("sourceUrl") or "https://fred.stlouisfed.org/")
    result["sources"] = result.get("sources") if isinstance(result.get("sources"), dict) else {}
    return result


def _with_mode(payload: Dict[str, Any], mode: str) -> Dict[str, Any]:
    return {**payload, "cacheMode": mode}


def _read_seeded(ctx: dict, panel_id: str) -> Optional[Dict[str, Any]]:
    namespace = _snapshot_namespace(panel_id)
    reader = ctx.get("get_cached_json")
    if callable(reader):
        payload = reader(namespace, CACHE_KEY)
        if isinstance(payload, dict):
            return _with_mode(payload, "redis-seed")
    store = ctx.get("SNAPSHOT_STORE")
    if store is not None:
        payload = store.get(namespace, CACHE_KEY)
        if isinstance(payload, dict):
            return _with_mode(payload, "sqlite-seed")
        stale = store.get_stale(namespace, CACHE_KEY)
        if isinstance(stale, dict):
            return _with_mode(stale, "stale-seed")
    return None


def get_macro_cpi_panel_snapshot(ctx: dict, panel_id: str, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    ttl = max(1800, int(getattr(ctx["SETTINGS"], "macro_cpi_panel_ttl_seconds", DEFAULT_TTL_SECONDS) or DEFAULT_TTL_SECONDS))
    seeded = _read_seeded(ctx, panel_id)
    if seeded is not None:
        return normalize_macro_cpi_panel_payload(seeded, ctx=ctx, panel_id=panel_id, limit=limit)
    payload = _with_mode(build_macro_cpi_panel_payload(ctx, panel_id, limit=limit), "live-build")
    if payload.get("items"):
        namespace = _snapshot_namespace(panel_id)
        store = ctx.get("SNAPSHOT_STORE")
        if store is not None:
            store.set(namespace, CACHE_KEY, payload, ttl)
        setter = ctx.get("set_cached_json")
        if callable(setter):
            setter(namespace, CACHE_KEY, payload, ttl)
    return normalize_macro_cpi_panel_payload(payload, ctx=ctx, panel_id=panel_id, limit=limit)


def get_supply_tariff_import_watch_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    return get_macro_cpi_panel_snapshot(ctx, "supply-tariff-import-watch", limit=limit)


def get_shelter_rent_oer_pressure_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    return get_macro_cpi_panel_snapshot(ctx, "shelter-rent-oer-pressure", limit=limit)


def get_labor_wage_services_pressure_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    return get_macro_cpi_panel_snapshot(ctx, "labor-wage-services-pressure", limit=limit)


def get_growth_demand_recession_tracker_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    return get_macro_cpi_panel_snapshot(ctx, "growth-demand-recession-tracker", limit=limit)


def get_fed_rates_polymarket_gap_snapshot(ctx: dict, limit: int = DEFAULT_ITEM_LIMIT) -> Dict[str, Any]:
    return get_macro_cpi_panel_snapshot(ctx, "fed-rates-polymarket-gap", limit=limit)
