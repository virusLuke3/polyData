from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from agent.common.json_utils import compact_text, extract_json_object
from agent.common.llm_client import OpenAICompatibleClient
from agent.common.tavily_client import TavilySearchClient

from .prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE


VALID_LENSES = {"overview", "special", "trend"}
LENS_ALIASES = {
    "brief": "overview",
    "flow": "special",
    "oracle": "trend",
    "catalyst": "trend",
    "radar": "trend",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _as_float(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return numeric if numeric == numeric else 0.0


def _fmt_compact(value: Any) -> str:
    numeric = _as_float(value)
    if abs(numeric) >= 1_000_000:
        return f"{numeric / 1_000_000:.1f}M"
    if abs(numeric) >= 1_000:
        return f"{numeric / 1_000:.1f}K"
    if numeric == int(numeric):
        return str(int(numeric))
    return f"{numeric:.1f}"


def _fmt_currency(value: Any) -> str:
    return f"${_fmt_compact(value)}"


def _items(payload: dict[str, Any], key: str) -> list[Any]:
    value = payload.get(key)
    return value if isinstance(value, list) else []


def _market_candidates(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for item in _items(payload, "markets"):
        if not isinstance(item, dict):
            continue
        candidates.append({
            "title": item.get("title") or item.get("slug") or "Untitled market",
            "category": item.get("category") or "market",
            "volume24h": item.get("volume24h"),
            "tradeCount24h": item.get("tradeCount24h"),
            "latestPrice": item.get("latestPrice"),
            "change24h": item.get("change24h"),
            "endDate": item.get("endDate"),
            "createdAt": item.get("createdAt"),
            "kind": "market",
        })
    for group in _items(payload, "marketGroups"):
        if not isinstance(group, dict):
            continue
        outcomes = group.get("topOutcomes") if isinstance(group.get("topOutcomes"), list) else group.get("outcomes")
        outcomes = outcomes if isinstance(outcomes, list) else []
        prices = [
            _as_float(outcome.get("yesPrice"))
            for outcome in outcomes
            if isinstance(outcome, dict) and outcome.get("yesPrice") not in (None, "")
        ]
        latest_price = prices[0] if prices else None
        candidates.append({
            "title": group.get("title") or group.get("slug") or "Untitled event",
            "category": group.get("category") or "market",
            "volume24h": group.get("volume24h"),
            "tradeCount24h": group.get("tradeCount24h"),
            "latestPrice": latest_price,
            "outcomeCount": group.get("outcomeCount") or len(outcomes),
            "endDate": group.get("endDate"),
            "createdAt": group.get("createdAt"),
            "kind": "group",
            "outcomes": [
                {
                    "label": outcome.get("label") or outcome.get("title"),
                    "yesPrice": outcome.get("yesPrice"),
                    "volume24h": outcome.get("volume24h"),
                    "tradeCount24h": outcome.get("tradeCount24h"),
                }
                for outcome in outcomes[:4]
                if isinstance(outcome, dict)
            ],
        })
    return candidates


def _top_categories(markets: list[Any]) -> list[str]:
    counts: dict[str, int] = {}
    for item in markets:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category") or "market").strip().lower() or "market"
        counts[category] = counts.get(category, 0) + 1
    return [f"{name} {count}" for name, count in sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:4]]


def _volume_total(items: list[Any]) -> float:
    total = 0.0
    for item in items:
        if isinstance(item, dict):
            total += _as_float(item.get("volume24h"))
    return total


def _signal_items(payload: dict[str, Any], key: str) -> list[Any]:
    value = payload.get(key)
    if isinstance(value, dict) and isinstance(value.get("items"), list):
        return value["items"]
    if isinstance(value, list):
        return value
    return []


def _market_reason(candidate: dict[str, Any]) -> tuple[str, str, str]:
    volume = _as_float(candidate.get("volume24h"))
    trades = _as_float(candidate.get("tradeCount24h"))
    price = _as_float(candidate.get("latestPrice"))
    outcome_count = _as_float(candidate.get("outcomeCount"))
    if volume > 0 and volume >= 10_000:
        return ("Liquidity spike", "Volume is unusually visible versus the rest of the loaded market set.", _fmt_currency(volume))
    if trades >= 20:
        return ("Tape active", "Trade count suggests this market is drawing attention today.", f"{_fmt_compact(trades)} trades")
    if price and 0.42 <= price <= 0.58:
        return ("Knife-edge odds", "Pricing is close to 50/50, so small catalysts can move the market quickly.", f"{price * 100:.0f}%")
    if outcome_count >= 8:
        return ("Crowded outcome set", "Many outcomes make this event useful for reading broad narrative dispersion.", f"{_fmt_compact(outcome_count)} outcomes")
    return ("Narrative watch", "This market is part of the current loaded universe and may anchor user attention.", str(candidate.get("category") or "market"))


def _special_markets(payload: dict[str, Any], limit: int = 4) -> list[dict[str, str]]:
    candidates = _market_candidates(payload)
    ranked = sorted(
        candidates,
        key=lambda item: (
            _as_float(item.get("volume24h")) * 3
            + _as_float(item.get("tradeCount24h")) * 250
            + (1500 if 0.42 <= _as_float(item.get("latestPrice")) <= 0.58 and _as_float(item.get("latestPrice")) else 0)
            + _as_float(item.get("outcomeCount")) * 80
        ),
        reverse=True,
    )
    output: list[dict[str, str]] = []
    for candidate in ranked[:limit]:
        trend, why, evidence = _market_reason(candidate)
        severity = "warning" if trend in {"Liquidity spike", "Knife-edge odds"} else "neutral"
        output.append({
            "title": compact_text(candidate.get("title"), 90),
            "why": compact_text(why, 150),
            "trend": trend,
            "severity": severity,
            "evidence": evidence,
        })
    return output


def _fallback_themes(payload: dict[str, Any], lens: str) -> list[dict[str, str]]:
    metrics = _summary_metrics(payload)
    top_categories = ", ".join(metrics["topCategories"]) or "category data loading"
    lead_market = (_special_markets(payload, limit=1) or [{"title": "No standout market yet"}])[0]["title"]
    if lens == "special":
        return [
            {
                "label": "SPECIAL",
                "title": "Unusual-market radar",
                "summary": f"{lead_market} is the strongest current candidate for a closer read.",
                "severity": "neutral",
                "evidence": f"{metrics['coveredMarkets']} covered",
            },
            {
                "label": "ATTENTION",
                "title": "Where attention clusters",
                "summary": top_categories,
                "severity": "neutral",
                "evidence": "categories",
            },
        ]
    if lens == "trend":
        return [
            {
                "label": "TREND",
                "title": "Polymarket narrative breadth",
                "summary": f"Attention is rotating around {top_categories}; watch whether one category becomes the dominant narrative.",
                "severity": "neutral",
                "evidence": f"{metrics['coveredMarkets']} covered",
            },
            {
                "label": "CATALYSTS",
                "title": "Catalyst feed",
                "summary": "News and signal feeds are being used to connect market moves with outside catalysts.",
                "severity": "positive" if metrics["contentItems"] else "warning",
                "evidence": f"{metrics['contentItems']} items",
            },
        ]
    return [
        {
            "label": "BREADTH",
            "title": "Market universe",
            "summary": f"The strongest current read starts with {lead_market}.",
            "severity": "positive" if metrics["coveredMarkets"] else "neutral",
            "evidence": f"{metrics['coveredMarkets']} covered",
        },
        {
            "label": "CONVERGENCE",
            "title": "Where Polymarket attention sits",
            "summary": top_categories,
            "severity": "neutral",
            "evidence": "categories",
        },
    ]


def _fallback_watchlist(payload: dict[str, Any], lens: str) -> list[dict[str, str]]:
    special = _special_markets(payload, limit=2)
    watchlist = [
        {
            "title": item["title"],
            "reason": item["why"],
            "horizon": "today",
            "severity": item["severity"],
        }
        for item in special
    ]
    if lens == "trend":
        watchlist.append({
            "title": "Narrative rotation",
            "reason": "Watch whether volume migrates from isolated events into a category-wide theme.",
            "horizon": "24h",
            "severity": "neutral",
        })
    else:
        watchlist.append({
            "title": "Fresh catalysts",
            "reason": "New information can turn a quiet market into the day's focal point.",
            "horizon": "today",
            "severity": "neutral",
        })
    return watchlist[:3]


def _summary_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    markets = _items(payload, "markets")
    groups = _items(payload, "marketGroups")
    candidates = _market_candidates(payload)
    trades = _items(payload, "trades")
    oracle = _items(payload, "oracle")
    content = _items(payload, "content")
    whales = _signal_items(payload, "whaleSignals")
    suspicious = _signal_items(payload, "suspiciousSignals")
    alpha = _signal_items(payload, "alphaSignals")
    return {
        "activeMarkets": len(markets),
        "marketGroups": len(groups),
        "coveredMarkets": len(candidates),
        "topCategories": _top_categories(candidates),
        "visible24hVolume": _fmt_currency(_volume_total(candidates)),
        "tradeRows": len(trades),
        "oracleEvents": len(oracle),
        "contentItems": len(content),
        "whaleSignals": len(whales),
        "suspiciousSignals": len(suspicious),
        "alphaSignals": len(alpha),
    }


def _search_query(payload: dict[str, Any], lens: str) -> str:
    markets = _market_candidates(payload)
    titles = " ".join(str(item.get("title") or "") for item in markets[:6])
    categories = " ".join(_top_categories(markets))
    if lens == "special":
        prefix = "Polymarket unusual markets today volume probability trend"
    elif lens == "trend":
        prefix = "Polymarket market trends macro narratives prediction markets today"
    else:
        prefix = "Polymarket market brief today special markets catalysts trends"
    return compact_text(f"{prefix} {categories} {titles}", 320)


def _fallback_focus(payload: dict[str, Any], lens: str, search_results: list[dict[str, str]]) -> list[dict[str, str]]:
    focus = _fallback_themes(payload, lens)
    if search_results:
        top = search_results[0]
        focus.insert(1, {
            "label": "NEWS",
            "title": compact_text(top.get("title") or "External context", 80),
            "summary": compact_text(top.get("content") or "External market context is available.", 180),
            "severity": "neutral",
            "evidence": "Tavily",
        })
    return focus[:5]


def _fallback_response(payload: dict[str, Any], lens: str, *, reason: str, search_results: list[dict[str, str]] | None = None) -> dict[str, Any]:
    search_results = search_results or []
    metrics = _summary_metrics(payload)
    special = _special_markets(payload)
    categories = ", ".join(metrics["topCategories"]) or "categories still loading"
    if lens == "special":
        lead = special[0]["title"] if special else "No standout market"
        brief = f"{lead} is the clearest unusual market on the board. Attention is also clustering around {categories}."
    elif lens == "trend":
        brief = f"Polymarket attention is rotating toward {categories}. Watch whether isolated event interest turns into a category-wide trend."
    else:
        lead = special[0]["title"] if special else categories
        brief = f"{lead} is anchoring the current market-wide read. The broader board is clustering around {categories}."
    evidence = [
        f"{metrics['coveredMarkets']} covered markets",
        f"{metrics['tradeRows']} recent trades",
        f"{len(special)} special markets",
        f"{metrics['visible24hVolume']} visible volume",
    ]
    if search_results:
        evidence[-1] = compact_text(search_results[0].get("title") or evidence[-1], 120)
    return {
        "status": "search-fallback" if reason == "agent-error" and search_results else reason,
        "lens": lens,
        "generatedAt": _utc_now_iso(),
        "model": "deterministic-fallback",
        "brief": compact_text(brief, 260),
        "focus": _fallback_focus(payload, lens, search_results),
        "specialMarkets": special,
        "themes": _fallback_themes(payload, lens),
        "watchlist": _fallback_watchlist(payload, lens),
        "evidence": evidence[:4],
        "metrics": metrics,
        "searchResults": search_results,
        "error": reason,
    }


def _normalize(raw: dict[str, Any], payload: dict[str, Any], lens: str, search_results: list[dict[str, str]], model: str) -> dict[str, Any]:
    fallback = _fallback_response(payload, lens, reason="fallback")
    focus_items = raw.get("focus") if isinstance(raw.get("focus"), list) else []
    focus: list[dict[str, str]] = []
    for item in focus_items[:5]:
        if not isinstance(item, dict):
            continue
        focus.append({
            "label": compact_text(item.get("label") or "SIGNAL", 16).upper(),
            "title": compact_text(item.get("title") or "Market-wide signal", 80),
            "summary": compact_text(item.get("summary") or "", 180),
            "severity": compact_text(item.get("severity") or "neutral", 20).lower(),
            "evidence": compact_text(item.get("evidence") or "", 80),
        })
    evidence = raw.get("evidence") if isinstance(raw.get("evidence"), list) else fallback["evidence"]
    raw_special = raw.get("specialMarkets") if isinstance(raw.get("specialMarkets"), list) else []
    special_markets: list[dict[str, str]] = []
    for item in raw_special[:4]:
        if not isinstance(item, dict):
            continue
        special_markets.append({
            "title": compact_text(item.get("title") or "Special market", 90),
            "why": compact_text(item.get("why") or item.get("summary") or "", 160),
            "trend": compact_text(item.get("trend") or "Watch", 40),
            "severity": compact_text(item.get("severity") or "neutral", 20).lower(),
            "evidence": compact_text(item.get("evidence") or "", 80),
        })
    raw_themes = raw.get("themes") if isinstance(raw.get("themes"), list) else []
    themes: list[dict[str, str]] = []
    for item in raw_themes[:4]:
        if not isinstance(item, dict):
            continue
        themes.append({
            "label": compact_text(item.get("label") or "THEME", 16).upper(),
            "title": compact_text(item.get("title") or "Market theme", 80),
            "summary": compact_text(item.get("summary") or "", 180),
            "severity": compact_text(item.get("severity") or "neutral", 20).lower(),
            "evidence": compact_text(item.get("evidence") or "", 80),
        })
    raw_watchlist = raw.get("watchlist") if isinstance(raw.get("watchlist"), list) else []
    watchlist: list[dict[str, str]] = []
    for item in raw_watchlist[:4]:
        if not isinstance(item, dict):
            continue
        watchlist.append({
            "title": compact_text(item.get("title") or "Watch item", 90),
            "reason": compact_text(item.get("reason") or item.get("summary") or "", 160),
            "horizon": compact_text(item.get("horizon") or "today", 24),
            "severity": compact_text(item.get("severity") or "neutral", 20).lower(),
        })
    return {
        "status": "live",
        "lens": lens,
        "generatedAt": _utc_now_iso(),
        "model": model,
        "brief": compact_text(raw.get("brief") or fallback["brief"], 260),
        "focus": focus or fallback["focus"],
        "specialMarkets": special_markets or fallback["specialMarkets"],
        "themes": themes or fallback["themes"],
        "watchlist": watchlist or fallback["watchlist"],
        "evidence": [compact_text(item, 120) for item in evidence[:4]],
        "metrics": _summary_metrics(payload),
        "searchResults": search_results,
    }


def build_market_wide_insight(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return _fallback_response({}, "overview", reason="invalid-payload")
    lens = str(payload.get("lens") or "overview").strip().lower()
    lens = LENS_ALIASES.get(lens, lens)
    if lens not in VALID_LENSES:
        lens = "overview"
    search_results: list[dict[str, str]] = []
    try:
        search_results = TavilySearchClient().search(_search_query(payload, lens))
    except Exception:
        search_results = []
    context = {
        "lens": lens,
        "metrics": _summary_metrics(payload),
        "marketCandidates": _market_candidates(payload)[:48],
        "markets": _items(payload, "markets")[:30],
        "marketGroups": _items(payload, "marketGroups")[:24],
        "trades": _items(payload, "trades")[:16],
        "oracle": _items(payload, "oracle")[:16],
        "content": _items(payload, "content")[:10],
        "alphaSignals": _signal_items(payload, "alphaSignals")[:8],
        "whaleSignals": _signal_items(payload, "whaleSignals")[:8],
        "suspiciousSignals": _signal_items(payload, "suspiciousSignals")[:8],
        "searchResults": search_results,
    }
    client = OpenAICompatibleClient()
    if not client.configured:
        return _fallback_response(payload, lens, reason="missing-api-key", search_results=search_results)
    try:
        prompt = USER_PROMPT_TEMPLATE.replace("{lens}", lens).replace("{context_json}", json.dumps(context, ensure_ascii=False, default=str))
        raw_text = client.complete_json(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=950,
        )
        raw = extract_json_object(raw_text)
        return _normalize(raw, payload, lens, search_results, client.model)
    except Exception as exc:
        response = _fallback_response(payload, lens, reason="agent-error", search_results=search_results)
        response["error"] = compact_text(str(exc), 180)
        return response


def build_market_wide_fallback(payload: dict[str, Any], *, reason: str = "cache-warming") -> dict[str, Any]:
    if not isinstance(payload, dict):
        return _fallback_response({}, "overview", reason="invalid-payload")
    lens = str(payload.get("lens") or "overview").strip().lower()
    lens = LENS_ALIASES.get(lens, lens)
    if lens not in VALID_LENSES:
        lens = "overview"
    return _fallback_response(payload, lens, reason=reason)
