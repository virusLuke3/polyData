from __future__ import annotations

from typing import Any, Dict
from datetime import datetime, timezone


def _empty_book_side() -> Dict[str, Any]:
    return {"bids": [], "asks": [], "bestBid": None, "bestAsk": None, "spread": None}


def _book_side_from_clob(ctx: dict, token_id: str) -> Dict[str, Any]:
    if not token_id:
        return _empty_book_side()
    session = ctx["get_clob_session"]()
    response = session.get(
        f"{ctx['CLOB_API_BASE'].rstrip('/')}/book",
        params={"token_id": token_id},
        timeout=min(float(ctx.get("CLOB_TIMEOUT_SECONDS") or 3), 3.0),
    )
    if response.status_code == 404:
        return _empty_book_side()
    response.raise_for_status()
    data = response.json() or {}

    def levels(name: str) -> list[dict[str, Any]]:
        rows = data.get(name) or []
        if not isinstance(rows, list):
            return []
        parsed: list[dict[str, Any]] = []
        for row in rows[:12]:
            if not isinstance(row, dict):
                continue
            parsed.append({"price": row.get("price"), "size": row.get("size")})
        return parsed

    bids = levels("bids")
    asks = levels("asks")
    best_bid = bids[0].get("price") if bids else None
    best_ask = asks[0].get("price") if asks else None
    spread = None
    try:
        if best_bid is not None and best_ask is not None:
            spread = str(float(best_ask) - float(best_bid))
    except (TypeError, ValueError):
        spread = None
    return {"bids": bids, "asks": asks, "bestBid": best_bid, "bestAsk": best_ask, "spread": spread}


def _clob_book_fallback(ctx: dict, market: Dict[str, Any], yes_token_id: str, no_token_id: str) -> Dict[str, Any]:
    return {
        "marketId": market.get("id"),
        "marketTitle": str(market.get("title") or ""),
        "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "yes": _book_side_from_clob(ctx, yes_token_id),
        "no": _book_side_from_clob(ctx, no_token_id),
    }


def get_runtime_lob_by_token_payload(
    ctx: dict,
    token_id: str,
    *,
    no_token_id: str = "",
    market_title: str = "",
) -> Dict[str, Any]:
    yes_token_id = str(token_id or "").strip()
    no_token_id = str(no_token_id or "").strip()
    if not yes_token_id:
        return {"error": "Missing token id", "marketId": 0, "localMarketId": None, "_status": 400}
    try:
        return {
            "marketId": 0,
            "localMarketId": None,
            "marketTitle": str(market_title or ""),
            "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "tokenMode": True,
            "yes": _book_side_from_clob(ctx, yes_token_id),
            "no": _book_side_from_clob(ctx, no_token_id) if no_token_id else _empty_book_side(),
        }
    except Exception as exc:
        ctx["app"].logger.exception("lob-runtime token fallback failed token_id=%s", yes_token_id)
        return {
            "error": "LOB token snapshot unavailable",
            "marketId": 0,
            "localMarketId": None,
            "detail": str(exc),
            "_status": 502,
        }


def get_runtime_lob_payload(ctx: dict, market_id: int) -> Dict[str, Any]:
    market = ctx["get_market_by_id"](market_id)
    if not market:
        return {"error": "Market not found", "marketId": market_id, "localMarketId": market_id, "_status": 404}
    yes_token_id = str(market.get("yes_token_id") or "").strip()
    no_token_id = str(market.get("no_token_id") or "").strip()
    if not yes_token_id or not no_token_id:
        return {"error": "Market is missing token ids", "marketId": market_id, "localMarketId": market_id, "_status": 409}
    try:
        return ctx["LOB_RUNTIME_MANAGER"].get_market_snapshot(
            market_id=market_id,
            yes_token_id=yes_token_id,
            no_token_id=no_token_id,
            market_title=str(market.get("title") or ""),
        )
    except Exception as exc:
        ctx["app"].logger.warning("lob-runtime failed market_id=%s; falling back to CLOB /book: %s", market_id, exc)
        try:
            return _clob_book_fallback(ctx, market, yes_token_id, no_token_id)
        except Exception as fallback_exc:
            ctx["app"].logger.exception("lob-runtime fallback failed market_id=%s", market_id)
            return {
                "error": "LOB runtime unavailable",
                "marketId": market_id,
                "localMarketId": market_id,
                "detail": str(fallback_exc),
                "_status": 502,
            }
