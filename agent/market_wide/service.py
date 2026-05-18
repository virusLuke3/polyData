from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from agent.common.json_utils import compact_text, extract_json_object
from agent.common.llm_client import OpenAICompatibleClient
from agent.common.tavily_client import TavilySearchClient

from .prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE


VALID_LENSES = {"overview", "flow", "oracle"}


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


def _summary_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    markets = _items(payload, "markets")
    groups = _items(payload, "marketGroups")
    trades = _items(payload, "trades")
    oracle = _items(payload, "oracle")
    content = _items(payload, "content")
    whales = _signal_items(payload, "whaleSignals")
    suspicious = _signal_items(payload, "suspiciousSignals")
    alpha = _signal_items(payload, "alphaSignals")
    return {
        "activeMarkets": len(markets),
        "marketGroups": len(groups),
        "topCategories": _top_categories(markets),
        "visible24hVolume": _fmt_currency(_volume_total(markets) or _volume_total(groups)),
        "tradeRows": len(trades),
        "oracleEvents": len(oracle),
        "contentItems": len(content),
        "whaleSignals": len(whales),
        "suspiciousSignals": len(suspicious),
        "alphaSignals": len(alpha),
    }


def _search_query(payload: dict[str, Any], lens: str) -> str:
    markets = [item for item in _items(payload, "markets") if isinstance(item, dict)]
    titles = " ".join(str(item.get("title") or "") for item in markets[:4])
    categories = " ".join(_top_categories(markets))
    if lens == "flow":
        prefix = "prediction market trading flow whale volume liquidity"
    elif lens == "oracle":
        prefix = "Polymarket oracle resolution settlement proposal market risk"
    else:
        prefix = "prediction markets global catalysts active markets"
    return compact_text(f"{prefix} {categories} {titles}", 320)


def _fallback_focus(payload: dict[str, Any], lens: str, search_results: list[dict[str, str]]) -> list[dict[str, str]]:
    metrics = _summary_metrics(payload)
    if lens == "flow":
        focus = [
            {
                "label": "FLOW",
                "title": "Cross-market tape loaded" if metrics["tradeRows"] else "Trade tape is quiet",
                "summary": f"{metrics['tradeRows']} recent trades are visible across the dashboard.",
                "severity": "positive" if metrics["tradeRows"] else "neutral",
                "evidence": f"{metrics['tradeRows']} trades",
            },
            {
                "label": "WHALES",
                "title": "Whale signals available" if metrics["whaleSignals"] else "No whale cluster loaded",
                "summary": f"{metrics['whaleSignals']} whale signals and {metrics['suspiciousSignals']} suspicious-flow signals are loaded.",
                "severity": "warning" if metrics["suspiciousSignals"] else "neutral",
                "evidence": f"{metrics['whaleSignals']} / {metrics['suspiciousSignals']}",
            },
            {
                "label": "LIQUIDITY",
                "title": "Visible volume breadth",
                "summary": f"Visible 24h volume across loaded markets is {metrics['visible24hVolume']}.",
                "severity": "neutral",
                "evidence": metrics["visible24hVolume"],
            },
        ]
    elif lens == "oracle":
        focus = [
            {
                "label": "ORACLE",
                "title": "Resolution queue visible" if metrics["oracleEvents"] else "Oracle queue quiet",
                "summary": f"{metrics['oracleEvents']} recent oracle events are loaded across markets.",
                "severity": "warning" if metrics["oracleEvents"] else "neutral",
                "evidence": f"{metrics['oracleEvents']} events",
            },
            {
                "label": "RISK",
                "title": "Settlement risk watch",
                "summary": "Markets near resolution need proposal, dispute, and final settlement monitoring.",
                "severity": "warning" if metrics["oracleEvents"] else "neutral",
                "evidence": "resolution",
            },
            {
                "label": "BREADTH",
                "title": "Active market coverage",
                "summary": f"{metrics['activeMarkets']} active markets are visible to the oracle watch.",
                "severity": "neutral",
                "evidence": f"{metrics['activeMarkets']} markets",
            },
        ]
    else:
        focus = [
            {
                "label": "BREADTH",
                "title": "Market universe loaded",
                "summary": f"{metrics['activeMarkets']} active markets and {metrics['marketGroups']} grouped markets are visible.",
                "severity": "positive" if metrics["activeMarkets"] else "neutral",
                "evidence": f"{metrics['activeMarkets']} markets",
            },
            {
                "label": "CATALYSTS",
                "title": "Content context available" if metrics["contentItems"] else "Catalyst feed thin",
                "summary": f"{metrics['contentItems']} latest content items and {metrics['alphaSignals']} alpha signals are loaded.",
                "severity": "positive" if metrics["contentItems"] else "warning",
                "evidence": f"{metrics['contentItems']} items",
            },
            {
                "label": "CONVERGENCE",
                "title": "Top market categories",
                "summary": ", ".join(metrics["topCategories"]) or "Category breadth is still loading.",
                "severity": "neutral",
                "evidence": "categories",
            },
        ]
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
    if lens == "flow":
        brief = f"Market-wide flow shows {metrics['tradeRows']} recent trades, {metrics['whaleSignals']} whale signals, and {metrics['suspiciousSignals']} suspicious-flow signals."
    elif lens == "oracle":
        brief = f"Oracle watch sees {metrics['oracleEvents']} recent resolution events across {metrics['activeMarkets']} active markets."
    else:
        brief = f"Market-wide dashboard covers {metrics['activeMarkets']} active markets with {metrics['visible24hVolume']} visible 24h volume."
    evidence = [
        f"{metrics['activeMarkets']} active markets",
        f"{metrics['tradeRows']} recent trades",
        f"{metrics['oracleEvents']} oracle events",
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
    return {
        "status": "live",
        "lens": lens,
        "generatedAt": _utc_now_iso(),
        "model": model,
        "brief": compact_text(raw.get("brief") or fallback["brief"], 260),
        "focus": focus or fallback["focus"],
        "evidence": [compact_text(item, 120) for item in evidence[:4]],
        "metrics": _summary_metrics(payload),
        "searchResults": search_results,
    }


def build_market_wide_insight(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return _fallback_response({}, "overview", reason="invalid-payload")
    lens = str(payload.get("lens") or "overview").strip().lower()
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

