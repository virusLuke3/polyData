#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone watcher for new Polymarket market panel signals.

The watcher is intentionally independent from market_discovery.py. It only reads
the indexed markets table, snapshots the first visible YES probability from the
CLOB order book, and stores recent panel items in Redis.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

_scripts_root = Path(__file__).resolve().parents[1]
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    import redis
except ImportError:
    redis = None

try:
    import requests
except ImportError:
    requests = None

from db import add_db_cli_args, configure_db_from_args, describe_db_target, dict_from_row, get_connection
from data_sources import POLYMARKET_CLOB_API_BASE
from api.config import load_api_settings


DEFAULT_NAMESPACE = "runtime:new-market-signals"
DEFAULT_INTERVAL_SECONDS = 20
DEFAULT_BATCH_LIMIT = 100
DEFAULT_RETENTION = 50
DEFAULT_PENDING_RETENTION = 500
DEFAULT_CLOB_TIMEOUT_SECONDS = 10
PLACEHOLDER_TITLE_PREFIXES = ("On-chain recovered market ",)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_decimal(value: Any) -> Optional[Decimal]:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _format_decimal(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    normalized = format(value, "f")
    return normalized.rstrip("0").rstrip(".") if "." in normalized else normalized


def _redis_key(prefix: str, namespace: str, suffix: str) -> str:
    clean_prefix = str(prefix or "")
    return f"{clean_prefix}{namespace}:{suffix}"


def _clean_title(value: Any) -> str:
    return str(value or "").strip()


def is_placeholder_market_title(value: Any) -> bool:
    title = _clean_title(value)
    if not title:
        return True
    return any(title.startswith(prefix) for prefix in PLACEHOLDER_TITLE_PREFIXES)


class NewMarketSignalWatcher:
    def __init__(
        self,
        *,
        redis_url: str,
        redis_prefix: str,
        namespace: str = DEFAULT_NAMESPACE,
        clob_api_base: str,
        clob_timeout_seconds: int = DEFAULT_CLOB_TIMEOUT_SECONDS,
        retention: int = DEFAULT_RETENTION,
    ) -> None:
        if redis is None:
            raise RuntimeError("redis package is required. Install scripts/requirements.txt")
        if requests is None:
            raise RuntimeError("requests package is required. Install scripts/requirements.txt")
        if not str(redis_url or "").strip():
            raise RuntimeError("POLYDATA_REDIS_URL is required for new market signal watcher")
        if not str(clob_api_base or "").strip():
            raise RuntimeError("POLYDATA_CLOB_API_BASE is required for probability snapshots")

        self.redis_prefix = redis_prefix
        self.namespace = namespace
        self.last_seen_key = _redis_key(redis_prefix, namespace, "last_seen_market_id")
        self.items_key = _redis_key(redis_prefix, namespace, "items")
        self.pending_key = _redis_key(redis_prefix, namespace, "pending_market_ids")
        self.retention = max(1, int(retention))
        self.clob_api_base = str(clob_api_base).rstrip("/")
        self.clob_timeout_seconds = max(1, int(clob_timeout_seconds))
        self.redis_client = redis.from_url(redis_url, decode_responses=True)
        self.http = requests.Session()
        self.http.headers.update({"Accept": "application/json", "User-Agent": "polyData-new-market-signal/1.0"})

    def get_last_seen_market_id(self) -> Optional[int]:
        raw = self.redis_client.get(self.last_seen_key)
        if raw in (None, ""):
            return None
        try:
            return int(str(raw))
        except (TypeError, ValueError):
            return None

    def set_last_seen_market_id(self, market_id: int) -> None:
        self.redis_client.set(self.last_seen_key, int(market_id))

    def get_current_max_market_id(self) -> int:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM markets")
            row = cursor.fetchone()
            data = dict_from_row(row)
            return int(data.get("max_id") or 0)
        finally:
            conn.close()

    def fetch_new_markets(self, last_seen_market_id: int, limit: int) -> List[Dict[str, Any]]:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, title, yes_token_id, created_at
                FROM markets
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (int(last_seen_market_id), int(limit)),
            )
            return [dict_from_row(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def fetch_markets_by_ids(self, market_ids: Iterable[int]) -> List[Dict[str, Any]]:
        ids = sorted({int(market_id) for market_id in market_ids if int(market_id or 0) > 0})
        if not ids:
            return []
        placeholders = ",".join(["?"] * len(ids))
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"""
                SELECT id, title, yes_token_id, created_at
                FROM markets
                WHERE id IN ({placeholders})
                ORDER BY id ASC
                """,
                ids,
            )
            return [dict_from_row(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def fetch_initial_yes_probability(self, yes_token_id: Any) -> tuple[Optional[str], str]:
        token_id = str(yes_token_id or "").strip()
        if not token_id:
            return None, "missing_yes_token"
        try:
            response = self.http.get(
                f"{self.clob_api_base}/book",
                params={"token_id": token_id},
                timeout=self.clob_timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json() if response.content else {}
        except Exception:
            return None, "clob_book_error"

        bids = payload.get("bids") if isinstance(payload, dict) else []
        asks = payload.get("asks") if isinstance(payload, dict) else []
        best_bid = _safe_decimal((bids or [{}])[0].get("price") if isinstance(bids, list) and bids else None)
        best_ask = _safe_decimal((asks or [{}])[0].get("price") if isinstance(asks, list) and asks else None)

        if best_bid is not None and best_ask is not None:
            return _format_decimal((best_bid + best_ask) / Decimal("2")), "clob_book_midpoint"
        if best_bid is not None:
            return _format_decimal(best_bid), "clob_book_best_bid"
        if best_ask is not None:
            return _format_decimal(best_ask), "clob_book_best_ask"
        return None, "clob_book_empty"

    def load_items(self) -> List[Dict[str, Any]]:
        raw = self.redis_client.get(self.items_key)
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []

    def store_items(self, items: Iterable[Dict[str, Any]]) -> None:
        normalized = [item for item in items if not is_placeholder_market_title(item.get("title"))][: self.retention]
        self.redis_client.set(self.items_key, json.dumps(normalized, ensure_ascii=True, default=str))

    def load_pending_market_ids(self) -> List[int]:
        raw = self.redis_client.get(self.pending_key)
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except Exception:
            return []
        if not isinstance(parsed, list):
            return []
        ids: List[int] = []
        for value in parsed:
            try:
                market_id = int(value)
            except (TypeError, ValueError):
                continue
            if market_id > 0:
                ids.append(market_id)
        return ids

    def store_pending_market_ids(self, market_ids: Iterable[int]) -> None:
        normalized = sorted({int(market_id) for market_id in market_ids if int(market_id or 0) > 0})
        self.redis_client.set(self.pending_key, json.dumps(normalized[-DEFAULT_PENDING_RETENTION:]))

    def is_signal_ready(self, row: Dict[str, Any]) -> bool:
        return not is_placeholder_market_title(row.get("title"))

    def run_once(self, *, limit: int = DEFAULT_BATCH_LIMIT) -> Dict[str, Any]:
        self.redis_client.ping()
        last_seen = self.get_last_seen_market_id()
        if last_seen is None:
            baseline = self.get_current_max_market_id()
            self.set_last_seen_market_id(baseline)
            return {"mode": "bootstrap", "lastSeenMarketId": baseline, "signals": 0}

        pending_ids = self.load_pending_market_ids()
        pending_rows = self.fetch_markets_by_ids(pending_ids)
        rows = self.fetch_new_markets(last_seen, limit=limit)
        if not rows and not pending_rows:
            return {"mode": "scan", "lastSeenMarketId": last_seen, "signals": 0, "pending": len(pending_ids)}

        observed_at = utc_now_iso()
        signals: List[Dict[str, Any]] = []
        max_seen = last_seen
        next_pending_ids = set(pending_ids)
        skipped = 0
        candidate_rows = [*pending_rows, *rows]
        seen_candidate_ids = set()
        for row in candidate_rows:
            market_id = int(row.get("id") or 0)
            if market_id <= 0 or market_id in seen_candidate_ids:
                continue
            seen_candidate_ids.add(market_id)
            max_seen = max(max_seen, market_id)
            if not self.is_signal_ready(row):
                next_pending_ids.add(market_id)
                skipped += 1
                continue
            probability, source = self.fetch_initial_yes_probability(row.get("yes_token_id"))
            next_pending_ids.discard(market_id)
            signals.append(
                {
                    "marketId": market_id,
                    "title": _clean_title(row.get("title")) or f"Market {market_id}",
                    "initialYesProbability": probability,
                    "probabilitySource": source,
                    "observedAt": observed_at,
                    "marketCreatedAt": row.get("created_at"),
                }
            )

        existing = self.load_items()
        seen_ids = {int(item.get("marketId")) for item in signals if item.get("marketId") is not None}
        deduped_existing = [item for item in existing if int(item.get("marketId") or 0) not in seen_ids]
        self.store_items([*reversed(signals), *deduped_existing])
        self.store_pending_market_ids(next_pending_ids)
        self.set_last_seen_market_id(max_seen)
        return {"mode": "scan", "lastSeenMarketId": max_seen, "signals": len(signals), "pending": len(next_pending_ids), "skipped": skipped}


def main() -> None:
    settings = load_api_settings()
    parser = argparse.ArgumentParser(description="Watch new markets and store panel signals in Redis")
    add_db_cli_args(parser)
    parser.add_argument("--watch", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS, help="Polling interval in seconds")
    parser.add_argument("--limit", type=int, default=DEFAULT_BATCH_LIMIT, help="Max markets to process per scan")
    parser.add_argument("--retention", type=int, default=DEFAULT_RETENTION, help="Recent Redis signal retention")
    parser.add_argument("--namespace", default=DEFAULT_NAMESPACE, help="Redis namespace after POLYDATA_REDIS_PREFIX")
    parser.add_argument("--redis-url", default=settings.redis_url, help="Redis URL")
    parser.add_argument("--redis-prefix", default=settings.redis_prefix, help="Redis key prefix")
    parser.add_argument("--clob-api-base", default=settings.clob_api_base or POLYMARKET_CLOB_API_BASE, help="Polymarket CLOB API base")
    parser.add_argument("--clob-timeout-seconds", type=int, default=settings.clob_timeout_seconds, help="CLOB request timeout")
    args = parser.parse_args()
    configure_db_from_args(args)

    watcher = NewMarketSignalWatcher(
        redis_url=args.redis_url,
        redis_prefix=args.redis_prefix,
        namespace=args.namespace,
        clob_api_base=args.clob_api_base,
        clob_timeout_seconds=args.clob_timeout_seconds,
        retention=args.retention,
    )
    print(f"[new-market-signal] db={describe_db_target()} redis_key={watcher.items_key}", file=sys.stderr)

    while True:
        started = time.perf_counter()
        try:
            result = watcher.run_once(limit=args.limit)
            elapsed_ms = (time.perf_counter() - started) * 1000
            print(f"[new-market-signal] {json.dumps(result, ensure_ascii=True)} duration_ms={elapsed_ms:.1f}", file=sys.stderr)
        except Exception as exc:
            print(f"[new-market-signal] scan failed: {exc}", file=sys.stderr)
            if not args.watch:
                raise
        if not args.watch:
            return
        time.sleep(max(1, int(args.interval)))


if __name__ == "__main__":
    main()
