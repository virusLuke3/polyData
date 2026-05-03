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

from api.services import runtime_service
from runtime import market_group_watcher
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


def make_settings(snapshot_path: str = "") -> SimpleNamespace:
    return SimpleNamespace(
        redis_url="redis://test/0",
        redis_prefix="polydata:",
        snapshot_sqlite_path=snapshot_path,
        finance_runtime_ttl_seconds=300,
        yahoo_chart_base_url="https://example.test/yahoo",
        coingecko_base_url="https://example.test/coingecko",
    )


def sample_payload(kind: str = "commodities") -> dict:
    return {
        "kind": kind,
        "items": [{"id": "gold", "label": "GOLD", "symbol": "GC=F", "price": 2400.0}],
        "generatedAt": "2026-05-03T08:00:00Z",
        "status": "ok",
    }


class MarketGroupSeedWatcherTestCase(unittest.TestCase):
    def make_watcher(self):
        snapshot_dir = tempfile.TemporaryDirectory()
        self.addCleanup(snapshot_dir.cleanup)
        fake_redis = FakeRedis()
        settings = make_settings(str(Path(snapshot_dir.name) / "snapshots.sqlite3"))
        redis_module = SimpleNamespace(from_url=lambda *args, **kwargs: fake_redis)
        requests_module = SimpleNamespace(Session=lambda: SimpleNamespace(headers={}))
        with patch.object(market_group_watcher, "redis", redis_module), patch.object(market_group_watcher, "requests", requests_module):
            watcher = market_group_watcher.MarketGroupWatcher(
                redis_url=settings.redis_url,
                redis_prefix=settings.redis_prefix,
                snapshot_sqlite_path=settings.snapshot_sqlite_path,
                settings=settings,
                interval_seconds=60,
            )
        return watcher, fake_redis

    def test_watcher_stores_commodities_payload_and_seed_meta(self):
        watcher, fake_redis = self.make_watcher()
        with patch.object(runtime_service, "fetch_live_market_group_payload", return_value=sample_payload("commodities")):
            result = watcher.run_component(panel_id="commodities-watch", kind="commodities", items=market_group_watcher.COMMODITY_SYMBOLS)

        self.assertEqual("ok", result["status"])
        cache_key = runtime_service.build_market_group_cache_key(market_group_watcher.COMMODITY_SYMBOLS, kind="commodities")
        stored = json.loads(fake_redis.get(f"polydata:snapshot:markets:commodities:{cache_key}") or "{}")
        self.assertEqual("seeded", stored["cacheMode"])
        meta = json.loads(fake_redis.get("polydata:seed-meta:markets:commodities-watch") or "{}")
        self.assertEqual("ok", meta["status"])
        self.assertEqual(1, meta["recordCount"])

    def test_api_reads_seeded_market_group_without_live_fetch(self):
        with tempfile.TemporaryDirectory() as snapshot_dir:
            settings = make_settings(str(Path(snapshot_dir) / "snapshots.sqlite3"))
            store = SnapshotStore(settings.snapshot_sqlite_path)
            symbols = [("gold", "GOLD", "GC=F")]
            cache_key = runtime_service.build_market_group_cache_key(symbols, kind="commodities")
            store.set("snapshot:markets:commodities", cache_key, sample_payload("commodities"), 300)
            ctx = {
                "SETTINGS": settings,
                "FINANCE_RUNTIME_TTL_SECONDS": 300,
                "SNAPSHOT_STORE": store,
                "get_cached_json": lambda namespace, key: None,
                "set_cached_json": lambda namespace, key, payload, ttl: None,
                "utc_now_iso": lambda: "2026-05-03T00:00:00Z",
            }
            with patch.object(runtime_service, "fetch_live_market_group_payload", side_effect=AssertionError("live fetch should not run")):
                payload = runtime_service.get_market_group_snapshot(ctx, symbols, kind="commodities")

        self.assertEqual("sqlite-seed", payload["cacheMode"])
        self.assertEqual("gold", payload["items"][0]["id"])


if __name__ == "__main__":
    unittest.main()
