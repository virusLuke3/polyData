from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.services import new_market_signal_service
from runtime.new_market_signal_watcher import NewMarketSignalWatcher


class FakeLogger:
    def exception(self, *args, **kwargs) -> None:
        return None


class FakeApp:
    logger = FakeLogger()


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.pings = 0

    def ping(self):
        self.pings += 1
        return True

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value):
        self.values[key] = str(value)
        return True


class NewMarketSignalServiceTestCase(unittest.TestCase):
    def test_snapshot_returns_items_from_redis_with_limit(self):
        redis_client = FakeRedis()
        redis_client.set(
            "polydata:runtime:new-market-signals:items",
            json.dumps(
                [
                    {"marketId": 2, "title": "Second", "initialYesProbability": "0.6"},
                    {"marketId": 1, "title": "First", "initialYesProbability": "0.4"},
                ]
            ),
        )
        ctx = {
            "REDIS_PREFIX": "polydata:",
            "get_redis_client": lambda: redis_client,
            "utc_now_iso": lambda: "2026-04-25T00:00:00Z",
            "app": FakeApp(),
        }

        payload = new_market_signal_service.get_new_market_signals_snapshot(ctx, limit=1)

        self.assertEqual([{"marketId": 2, "title": "Second", "initialYesProbability": "0.6"}], payload["items"])
        self.assertEqual("2026-04-25T00:00:00Z", payload["generatedAt"])

    def test_snapshot_degrades_when_redis_unavailable(self):
        ctx = {
            "REDIS_PREFIX": "polydata:",
            "get_redis_client": lambda: None,
            "utc_now_iso": lambda: "2026-04-25T00:00:00Z",
            "app": FakeApp(),
        }

        payload = new_market_signal_service.get_new_market_signals_snapshot(ctx, limit=12)

        self.assertEqual([], payload["items"])
        self.assertEqual("degraded", payload["status"])


class NewMarketSignalWatcherTestCase(unittest.TestCase):
    def make_watcher(self) -> NewMarketSignalWatcher:
        watcher = NewMarketSignalWatcher.__new__(NewMarketSignalWatcher)
        watcher.redis_client = FakeRedis()
        watcher.last_seen_key = "polydata:runtime:new-market-signals:last_seen_market_id"
        watcher.items_key = "polydata:runtime:new-market-signals:items"
        watcher.retention = 50
        return watcher

    def test_first_run_bootstraps_without_signals(self):
        watcher = self.make_watcher()
        watcher.get_current_max_market_id = lambda: 42

        result = watcher.run_once(limit=100)

        self.assertEqual("bootstrap", result["mode"])
        self.assertEqual(42, result["lastSeenMarketId"])
        self.assertEqual("42", watcher.redis_client.get(watcher.last_seen_key))
        self.assertIsNone(watcher.redis_client.get(watcher.items_key))

    def test_scan_generates_signals_once_and_advances_watermark(self):
        watcher = self.make_watcher()
        watcher.set_last_seen_market_id(10)
        watcher.fetch_new_markets = lambda last_seen, limit: [
            {"id": 11, "title": "Will this market launch?", "yes_token_id": "yes-11", "created_at": "2026-04-25T00:00:00Z"}
        ]
        watcher.fetch_initial_yes_probability = lambda yes_token_id: ("0.57", "clob_book_midpoint")

        result = watcher.run_once(limit=100)
        items = json.loads(watcher.redis_client.get(watcher.items_key))

        self.assertEqual("scan", result["mode"])
        self.assertEqual(1, result["signals"])
        self.assertEqual("11", watcher.redis_client.get(watcher.last_seen_key))
        self.assertEqual(11, items[0]["marketId"])
        self.assertEqual("0.57", items[0]["initialYesProbability"])


if __name__ == "__main__":
    unittest.main()
