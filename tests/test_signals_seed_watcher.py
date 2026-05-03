from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.services import signal_service
from runtime import signals_watcher
from runtime.snapshot_store import SnapshotStore


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def ping(self) -> bool:
        return True

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = value

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.set(key, value, ex=ttl)


class SignalsSeedWatcherTestCase(unittest.TestCase):
    def make_watcher(self, component: str = "whales", limit: int = 14):
        snapshot_dir = tempfile.TemporaryDirectory()
        self.addCleanup(snapshot_dir.cleanup)
        fake_redis = FakeRedis()
        redis_module = SimpleNamespace(from_url=lambda *args, **kwargs: fake_redis)
        with patch.object(signals_watcher, "redis", redis_module):
            watcher = signals_watcher.SignalsWatcher(
                redis_url="redis://test/0",
                redis_prefix="polydata:",
                snapshot_sqlite_path=str(Path(snapshot_dir.name) / "snapshots.sqlite3"),
                component=component,
                limit=limit,
                interval_seconds=45,
            )
        return watcher, fake_redis

    def test_watcher_stores_whale_payload_and_seed_meta(self):
        watcher, fake_redis = self.make_watcher(component="whales", limit=14)
        payload = {"items": [{"title": "Whale flow"}], "generatedAt": "2026-05-03T08:00:00Z", "status": "ok"}
        with patch.object(watcher, "fetch_payload", return_value=payload):
            result = watcher.run_once()

        self.assertEqual("ok", result["status"])
        cache_key = signal_service.build_whale_trades_cache_key(limit=14)
        stored = json.loads(fake_redis.get(f"polydata:snapshot:signals:whales:{cache_key}") or "{}")
        self.assertEqual("seeded", stored["cacheMode"])
        self.assertEqual("ok", stored["status"])
        meta = json.loads(fake_redis.get("polydata:seed-meta:signals:whale-trades") or "{}")
        self.assertEqual("ok", meta["status"])
        self.assertEqual(1, meta["recordCount"])

    def test_watcher_preserves_previous_payload_when_new_payload_is_empty(self):
        watcher, fake_redis = self.make_watcher(component="alpha", limit=8)
        previous = {"items": [{"title": "Old alpha"}], "generatedAt": "old", "status": "ok", "cacheMode": "seeded"}
        watcher.store_payload(previous)
        with patch.object(watcher, "fetch_payload", return_value={"items": [], "generatedAt": "new", "status": "empty"}):
            result = watcher.run_once()

        self.assertEqual("preserved", result["status"])
        stored = json.loads(fake_redis.get(watcher.redis_key()) or "{}")
        self.assertEqual("Old alpha", stored["items"][0]["title"])
        meta = json.loads(fake_redis.get("polydata:seed-meta:signals:alpha-signal") or "{}")
        self.assertEqual("preserved", meta["status"])

    def test_api_reads_seeded_signal_redis_without_live_build(self):
        with tempfile.TemporaryDirectory() as snapshot_dir:
            store = SnapshotStore(str(Path(snapshot_dir) / "snapshots.sqlite3"))
            cache_key = signal_service.build_alpha_signal_cache_key(limit=8)
            seeded = {"items": [{"title": "Seeded alpha"}], "generatedAt": "seed", "cacheMode": "seeded"}
            ctx = {
                "SIGNAL_RUNTIME_TTL_SECONDS": 45,
                "SNAPSHOT_STORE": store,
                "get_cached_runtime_payload": lambda namespace, key: None,
                "set_cached_runtime_payload": lambda namespace, key, payload, ttl: payload,
                "get_cached_json": lambda namespace, key: seeded if (namespace, key) == (signal_service.SIGNAL_SNAPSHOT_NAMESPACE_ALPHA, cache_key) else None,
                "threading": SimpleNamespace(Thread=object),
                "app": SimpleNamespace(logger=SimpleNamespace(info=lambda *args, **kwargs: None, exception=lambda *args, **kwargs: None)),
                "utc_now_iso": lambda: "2026-05-03T08:00:00Z",
            }
            with patch.object(signal_service, "fetch_live_alpha_signal_payload", side_effect=AssertionError("live build should not run")):
                payload = signal_service.get_alpha_signal_snapshot(ctx, limit=8)

        self.assertEqual("seeded", payload["cacheMode"])
        self.assertEqual("Seeded alpha", payload["items"][0]["title"])

    def test_alpha_live_payload_degrades_when_database_sources_fail(self):
        ctx = {
            "app": SimpleNamespace(logger=SimpleNamespace(exception=lambda *args, **kwargs: None)),
            "utc_now_iso": lambda: "2026-05-03T08:00:00Z",
            "get_recent_trades": lambda limit=24: (_ for _ in ()).throw(RuntimeError("db down")),
            "get_recent_oracle_events": lambda limit=24: (_ for _ in ()).throw(RuntimeError("db down")),
            "get_active_markets_snapshot": lambda page_size=8: (_ for _ in ()).throw(RuntimeError("db down")),
            "get_market_group_snapshot": lambda items, kind: {"items": [{"label": "BTC", "changePercent": 3.2, "price": 68000}]},
            "get_inflation_nowcast_snapshot": lambda: {"monthOverMonth": {"CPI": "0.41", "Core CPI": "0.21"}},
            "CRYPTO_SYMBOLS": [("btc", "BTC", "BTC-USD")],
            "_safe_decimal": lambda value: None,
            "_safe_float": lambda value: float(value) if value is not None else None,
            "format_trade_decimal": lambda value: value,
            "format_trade_address": lambda value: value,
            "parse_iso_datetime": lambda value: None,
            "utc_date_days_ago": lambda days: "2026-05-01",
        }

        payload = signal_service.fetch_live_alpha_signal_payload(ctx, limit=3)

        self.assertEqual("ok", payload["status"])
        self.assertGreaterEqual(len(payload["items"]), 1)
        self.assertEqual("macro", payload["items"][0]["kind"])


if __name__ == "__main__":
    unittest.main()
