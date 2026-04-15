from __future__ import annotations

import json
from datetime import timedelta
from decimal import Decimal
from typing import Any, Dict, Iterable, List


CRITICAL_NOTIONAL = Decimal("2500")
ELEVATED_NOTIONAL = Decimal("1000")


def _severity_for_notional(ctx: dict, notional: Any) -> str:
    value = ctx["_safe_decimal"](notional)
    if value is not None and value >= CRITICAL_NOTIONAL:
        return "critical"
    if value is not None and value >= ELEVATED_NOTIONAL:
        return "elevated"
    return "watch"


def _format_trade_item(ctx: dict, row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "marketId": row.get("market_id"),
        "marketTitle": row.get("market_title"),
        "timestamp": row.get("timestamp"),
        "txHash": row.get("tx_hash"),
        "outcome": row.get("outcome"),
        "side": row.get("side"),
        "price": ctx["format_trade_decimal"](row.get("price")),
        "size": ctx["format_trade_decimal"](row.get("size")),
        "notional": ctx["format_trade_decimal"](row.get("notional")),
        "maker": ctx["format_trade_address"](row.get("maker")),
        "taker": ctx["format_trade_address"](row.get("taker")),
        "severity": _severity_for_notional(ctx, row.get("notional")),
    }


def _query_whale_rows(ctx: dict, *, limit: int, lookback_days: int) -> List[Dict[str, Any]]:
    threshold = ctx["iso_days_before"](ctx["utc_now_iso"](), lookback_days) or ctx["utc_date_days_ago"](lookback_days)
    threshold_dt = ctx["parse_iso_datetime"](threshold)
    recent_trades = ctx["get_recent_trades"](limit=max(160, limit * 24))
    rows: List[Dict[str, Any]] = []
    for trade in recent_trades:
        market_id = trade.get("marketId") or trade.get("market_id")
        if market_id is None:
            continue
        timestamp = trade.get("timestamp")
        timestamp_dt = ctx["parse_iso_datetime"](timestamp)
        if threshold_dt is not None and timestamp_dt is not None and timestamp_dt < threshold_dt:
            continue
        price = ctx["_safe_decimal"](trade.get("price"))
        size = ctx["_safe_decimal"](trade.get("size"))
        notional = ctx["_safe_decimal"](trade.get("notional"))
        if notional is None and price is not None and size is not None:
            notional = price * size
        rows.append(
            {
                "market_id": market_id,
                "market_title": trade.get("marketTitle") or trade.get("market_title"),
                "timestamp": timestamp,
                "tx_hash": trade.get("txHash") or trade.get("tx_hash"),
                "outcome": trade.get("outcome"),
                "side": trade.get("side"),
                "price": price,
                "size": size,
                "notional": notional,
                "maker": trade.get("maker"),
                "taker": trade.get("taker"),
            }
        )
    rows.sort(key=lambda row: (ctx["_safe_decimal"](row.get("notional")) or Decimal("0")), reverse=True)
    return rows[: max(limit * 2, limit)]


def get_whale_trades_snapshot(ctx: dict, limit: int = 14, lookback_days: int = 7) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit, "lookbackDays": lookback_days}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        rows = _query_whale_rows(ctx, limit=max(limit * 2, limit), lookback_days=lookback_days)
        items: List[Dict[str, Any]] = []
        seen_hashes: set[str] = set()
        for row in rows:
            tx_hash = str(row.get("tx_hash") or "")
            if tx_hash and tx_hash in seen_hashes:
                continue
            if tx_hash:
                seen_hashes.add(tx_hash)
            items.append(_format_trade_item(ctx, row))
            if len(items) >= limit:
                break
        return {"items": items, "generatedAt": ctx["utc_now_iso"]()}

    return ctx["get_snapshot_payload"]("snapshot:trades:whales", cache_key, _builder, ttl_seconds=ctx["SIGNAL_RUNTIME_TTL_SECONDS"])


def _recent_oracle_candidates(ctx: dict, limit: int) -> List[Dict[str, Any]]:
    events = ctx["get_recent_oracle_events"](limit=max(limit * 2, 16))
    filtered = []
    seen: set[tuple[Any, Any]] = set()
    for event in events:
        market_id = event.get("marketId") or event.get("market_id")
        event_time = event.get("eventTime") or event.get("event_time")
        if market_id is None or not event_time:
            continue
        key = (market_id, event_time)
        if key in seen:
            continue
        seen.add(key)
        filtered.append(event)
    return filtered[: max(limit, 8)]


def get_suspicious_trades_snapshot(ctx: dict, limit: int = 12) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        oracle_events = _recent_oracle_candidates(ctx, limit)
        recent_trades = ctx["get_recent_trades"](limit=max(200, limit * 30))
        items: List[Dict[str, Any]] = []
        seen_hashes: set[str] = set()
        oracle_by_market: Dict[Any, List[Dict[str, Any]]] = {}
        for event in oracle_events:
            market_id = event.get("marketId") or event.get("market_id")
            if market_id is None:
                continue
            oracle_by_market.setdefault(market_id, []).append(event)

        for trade in recent_trades:
            market_id = trade.get("marketId") or trade.get("market_id")
            if market_id is None or market_id not in oracle_by_market:
                continue
            trade_time = ctx["parse_iso_datetime"](trade.get("timestamp"))
            if trade_time is None:
                continue
            for event in oracle_by_market[market_id]:
                event_time = event.get("eventTime") or event.get("event_time")
                event_dt = ctx["parse_iso_datetime"](event_time)
                if event_dt is None:
                    continue
                if not (event_dt - timedelta(hours=6) <= trade_time <= event_dt):
                    continue
                tx_hash = str(trade.get("txHash") or trade.get("tx_hash") or "")
                if tx_hash and tx_hash in seen_hashes:
                    continue
                if tx_hash:
                    seen_hashes.add(tx_hash)
                price = ctx["_safe_decimal"](trade.get("price"))
                size = ctx["_safe_decimal"](trade.get("size"))
                notional = ctx["_safe_decimal"](trade.get("notional"))
                if notional is None and price is not None and size is not None:
                    notional = price * size
                item = _format_trade_item(
                    ctx,
                    {
                        "market_id": market_id,
                        "market_title": trade.get("marketTitle") or trade.get("market_title") or event.get("marketTitle") or event.get("market_title"),
                        "timestamp": trade.get("timestamp"),
                        "tx_hash": tx_hash,
                        "outcome": trade.get("outcome"),
                        "side": trade.get("side"),
                        "price": price,
                        "size": size,
                        "notional": notional,
                        "maker": trade.get("maker"),
                        "taker": trade.get("taker"),
                    },
                )
                item.update(
                    {
                        "eventStatus": event.get("eventStatus") or event.get("event_status"),
                        "eventTime": event_time,
                        "summary": f"{event.get('eventStatus') or event.get('event_status') or 'oracle'} window trade near oracle event",
                    }
                )
                items.append(item)
                break
            if len(items) >= limit:
                break

        if items:
            items.sort(key=lambda item: (ctx["_safe_decimal"](item.get("notional")) or Decimal("0")), reverse=True)
            return {"items": items[:limit], "generatedAt": ctx["utc_now_iso"]()}

        whales = get_whale_trades_snapshot(ctx, limit=limit, lookback_days=1).get("items", [])
        fallback_items = []
        for item in whales[:limit]:
            fallback_items.append(
                {
                    **item,
                    "eventStatus": "heuristic",
                    "summary": "Large live trade surfaced by fallback heuristic",
                }
            )
        return {"items": fallback_items, "generatedAt": ctx["utc_now_iso"]()}

    return ctx["get_snapshot_payload"]("snapshot:trades:suspicious", cache_key, _builder, ttl_seconds=ctx["SIGNAL_RUNTIME_TTL_SECONDS"])


def _append_signal(signals: List[Dict[str, Any]], *, kind: str, severity: str, title: Any, summary: str, timestamp: Any, contributors: Iterable[str] | None = None) -> None:
    signals.append(
        {
            "kind": kind,
            "severity": severity,
            "title": title,
            "summary": summary,
            "timestamp": timestamp,
            "contributors": list(contributors or []),
        }
    )


def get_alpha_signal_snapshot(ctx: dict, limit: int = 8) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        whales = get_whale_trades_snapshot(ctx, limit=6).get("items", [])
        suspicious = get_suspicious_trades_snapshot(ctx, limit=6).get("items", [])
        signals: List[Dict[str, Any]] = []

        for trade in whales[:3]:
            _append_signal(
                signals,
                kind="whale",
                severity=trade.get("severity") or "elevated",
                title=trade.get("marketTitle") or "Whale flow",
                summary=f"{str(trade.get('side') or 'trade').upper()} {trade.get('outcome') or '--'} at {trade.get('price') or '--'} on-chain, notional {trade.get('notional') or '--'}",
                timestamp=trade.get("timestamp"),
                contributors=["whale", "onchain"],
            )

        for trade in suspicious[:3]:
            _append_signal(
                signals,
                kind="suspicious",
                severity=trade.get("severity") or "watch",
                title=trade.get("marketTitle") or "Pre-oracle activity",
                summary=f"{trade.get('eventStatus') or 'oracle'} proximity trade, notional {trade.get('notional') or '--'}",
                timestamp=trade.get("timestamp"),
                contributors=["oracle", "timing"],
            )

        for market in ctx["get_active_markets_snapshot"](page_size=8).get("items", [])[:2]:
            price = ctx["_safe_decimal"](market.get("latestPrice"))
            change_24h = ctx["_safe_decimal"](market.get("change24h"))
            if price is None:
                continue
            severity = "watch"
            if change_24h is not None and abs(change_24h) >= Decimal("0.08"):
                severity = "elevated"
            _append_signal(
                signals,
                kind="momentum",
                severity=severity,
                title=market.get("title"),
                summary=f"Live probability {ctx['format_trade_decimal'](price)} with 24h change {ctx['format_trade_decimal'](change_24h) or '--'}",
                timestamp=ctx["utc_now_iso"](),
                contributors=["price", "market"],
            )

        if len(signals) < limit:
            crypto = ctx["get_market_group_snapshot"](ctx["CRYPTO_SYMBOLS"][:3], kind="crypto").get("items", [])
            for item in crypto[:2]:
                change = ctx["_safe_float"](item.get("changePercent"))
                _append_signal(
                    signals,
                    kind="macro",
                    severity="elevated" if change is not None and abs(change) >= 2 else "watch",
                    title=f"{item.get('label')} momentum",
                    summary=f"24h move {change:+.2f}% with runtime quote {item.get('price')}" if change is not None else "Runtime quote available",
                    timestamp=ctx["utc_now_iso"](),
                    contributors=["crypto", "macro"],
                )
                if len(signals) >= limit:
                    break

        if len(signals) < limit:
            nowcast = ctx["get_inflation_nowcast_snapshot"]()
            mom = nowcast.get("monthOverMonth") or {}
            if mom:
                _append_signal(
                    signals,
                    kind="macro",
                    severity="watch",
                    title="Cleveland Fed nowcast",
                    summary=f"CPI MoM {mom.get('CPI', '--')} / Core CPI {mom.get('Core CPI', '--')}",
                    timestamp=ctx["utc_now_iso"](),
                    contributors=["macro", "inflation"],
                )

        deduped: List[Dict[str, Any]] = []
        seen = set()
        for signal in signals:
            key = (signal.get("kind"), signal.get("title"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(signal)
            if len(deduped) >= limit:
                break
        return {"items": deduped, "generatedAt": ctx["utc_now_iso"]()}

    return ctx["get_snapshot_payload"]("snapshot:signals:alpha", cache_key, _builder, ttl_seconds=ctx["SIGNAL_RUNTIME_TTL_SECONDS"])
