#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lightweight in-memory LOB runtime for webpage Phase 1."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

import requests

from data_sources import POLYMARKET_CLOB_API_BASE

CLOB_API_BASE = POLYMARKET_CLOB_API_BASE
DEFAULT_TIMEOUT_SECONDS = 10
DEFAULT_CACHE_TTL_SECONDS = 3
DEFAULT_DEPTH_LIMIT = 5


def _safe_decimal_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        normalized = format(Decimal(text), "f")
    except (InvalidOperation, ValueError, TypeError):
        return None
    return normalized.rstrip("0").rstrip(".") if "." in normalized else normalized


def _spread(best_bid: Optional[str], best_ask: Optional[str]) -> Optional[str]:
    if best_bid is None or best_ask is None:
        return None
    try:
        value = Decimal(best_ask) - Decimal(best_bid)
    except (InvalidOperation, ValueError, TypeError):
        return None
    normalized = format(value, "f")
    return normalized.rstrip("0").rstrip(".") if "." in normalized else normalized


def _normalize_levels(levels: Any, side: str, limit: int) -> List[Dict[str, str]]:
    items = levels if isinstance(levels, list) else []
    normalized: List[Dict[str, str]] = []
    for raw in items[:limit]:
        if not isinstance(raw, dict):
            continue
        price = _safe_decimal_text(raw.get("price"))
        size = _safe_decimal_text(raw.get("size"))
        if price is None or size is None:
            continue
        normalized.append({"side": side, "price": price, "size": size})
    return normalized


@dataclass
class TokenBookSnapshot:
    token_id: str
    best_bid: Optional[str]
    best_ask: Optional[str]
    spread: Optional[str]
    bids: List[Dict[str, str]]
    asks: List[Dict[str, str]]
    updated_at: str


class LOBRuntimeManager:
    def __init__(
        self,
        *,
        cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        depth_limit: int = DEFAULT_DEPTH_LIMIT,
        api_base: str = CLOB_API_BASE,
    ) -> None:
        self.cache_ttl_seconds = max(1, int(cache_ttl_seconds))
        self.timeout_seconds = max(1, int(timeout_seconds))
        self.depth_limit = max(1, int(depth_limit))
        self.api_base = str(api_base or "").rstrip("/")
        self._cache: Dict[int, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "polyData-lob-runtime/1.0",
            }
        )

    def get_market_snapshot(
        self,
        *,
        market_id: int,
        yes_token_id: str,
        no_token_id: str,
        market_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            cached = self._cache.get(market_id)
            if cached and now - cached.get("_cached_at", 0.0) < self.cache_ttl_seconds:
                return cached["payload"]

        yes_payload = self._fetch_book_snapshot(yes_token_id)
        no_payload = self._fetch_book_snapshot(no_token_id)
        updated_at = max(yes_payload.updated_at, no_payload.updated_at)
        payload = {
            "marketId": market_id,
            "localMarketId": market_id,
            "marketTitle": market_title,
            "updatedAt": updated_at,
            "yes": {
                "tokenId": yes_payload.token_id,
                "bestBid": yes_payload.best_bid,
                "bestAsk": yes_payload.best_ask,
                "spread": yes_payload.spread,
                "bids": yes_payload.bids,
                "asks": yes_payload.asks,
            },
            "no": {
                "tokenId": no_payload.token_id,
                "bestBid": no_payload.best_bid,
                "bestAsk": no_payload.best_ask,
                "spread": no_payload.spread,
                "bids": no_payload.bids,
                "asks": no_payload.asks,
            },
        }

        with self._lock:
            self._cache[market_id] = {"_cached_at": now, "payload": payload}
        return payload

    def _fetch_book_snapshot(self, token_id: str) -> TokenBookSnapshot:
        response = self._session.get(
            f"{self.api_base}/book",
            params={"token_id": token_id},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        bids = _normalize_levels(payload.get("bids"), "bid", self.depth_limit)
        asks = _normalize_levels(payload.get("asks"), "ask", self.depth_limit)
        best_bid = bids[0]["price"] if bids else None
        best_ask = asks[0]["price"] if asks else None
        return TokenBookSnapshot(
            token_id=str(token_id),
            best_bid=best_bid,
            best_ask=best_ask,
            spread=_spread(best_bid, best_ask),
            bids=bids,
            asks=asks,
            updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
