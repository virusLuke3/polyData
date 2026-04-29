from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict

from flask import Flask


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.routes.runtime_panels import create_runtime_panels_blueprint
from api.services import geo_sanctions_shock_service
from runtime.geo_sanctions_shock_watcher import GeoSanctionsShockWatcher
from runtime.snapshot_store import SnapshotStore


SDN_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<sdnList xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation>
    <Publish_Date>04/28/2026</Publish_Date>
    <Record_Count>4</Record_Count>
  </publshInformation>
  <sdnEntry>
    <uid>100</uid>
    <lastName>IRAN SHIPPING GROUP</lastName>
    <sdnType>Entity</sdnType>
    <programList><program>IRAN</program></programList>
    <addressList><address><country>Iran</country></address></addressList>
  </sdnEntry>
</sdnList>
"""

CONSOLIDATED_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<sdnList xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation>
    <Publish_Date>04/27/2026</Publish_Date>
    <Record_Count>2</Record_Count>
  </publshInformation>
  <sdnEntry>
    <uid>200</uid>
    <lastName>BEIJING EXPORT FIRM</lastName>
    <sdnType>Entity</sdnType>
    <programList><program>NS-CMIC</program></programList>
    <addressList><address><country>China</country></address></addressList>
  </sdnEntry>
</sdnList>
"""


class FakeLogger:
    def exception(self, *args, **kwargs) -> None:
        return None

    def warning(self, *args, **kwargs) -> None:
        return None

    def info(self, *args, **kwargs) -> None:
        return None


class FakeApp:
    logger = FakeLogger()


class FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200):
        self.content = content
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class FakeRequests:
    def get(self, url: str, timeout: int = 20, headers: Dict[str, str] | None = None):
        if url == "sdn-url":
            return FakeResponse(SDN_XML)
        if url == "cons-url":
            return FakeResponse(CONSOLIDATED_XML)
        raise RuntimeError(f"unexpected url {url}")


class FakeRedis:
    def __init__(self) -> None:
        self.values: Dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = value

    def ping(self) -> bool:
        return True


class GeoSanctionsShockSeedBuilderTestCase(unittest.TestCase):
    def make_context(self, *, requests_lib: Any = None, conflict_url: str = "conflict-url", previous_total: int = 3) -> Dict[str, Any]:
        settings = SimpleNamespace(
            geo_shock_ofac_sdn_url="sdn-url",
            geo_shock_ofac_consolidated_url="cons-url",
            geo_shock_federal_register_api_url="fr-url",
            geo_shock_conflict_api_url=conflict_url,
            geo_shock_source_url="https://ofac.treasury.gov/sanctions-list-service",
            geo_shock_ttl_seconds=900,
        )

        def http_json_get(url, params=None, timeout=12, headers=None):
            if url == "fr-url":
                term = str((params or {}).get("conditions[term]") or "")
                if term == "Iran sanctions":
                    return {
                        "results": [
                            {
                                "title": "Notice of OFAC Sanctions Action",
                                "abstract": "Treasury is designating persons in Iran.",
                                "document_number": "2026-00001",
                                "html_url": "https://federalregister.gov/d/2026-00001",
                                "publication_date": "2026-04-24",
                                "type": "Notice",
                            }
                        ]
                    }
                if term == "China sanctions":
                    return {
                        "results": [
                            {
                                "title": "Executive Order on Export Controls to China",
                                "abstract": "Restrictions on strategic exports to China.",
                                "document_number": "2026-00002",
                                "html_url": "https://federalregister.gov/d/2026-00002",
                                "publication_date": "2026-04-23",
                                "type": "Presidential Document",
                            }
                        ]
                    }
                return {"results": []}
            if url == "conflict-url":
                return {
                    "items": [
                        {
                            "id": "evt-1",
                            "headline": "Missile strike near Iranian nuclear site",
                            "country": "Iran",
                            "event_date": "2026-04-25T00:00:00Z",
                            "tags": ["military", "nuclear"],
                            "source": "WorldMonitor",
                        }
                    ]
                }
            raise RuntimeError(f"unexpected url {url}")

        return {
            "SETTINGS": settings,
            "app": FakeApp(),
            "requests": requests_lib,
            "http_json_get": http_json_get,
            "utc_now_iso": lambda: "2026-04-28T00:00:00Z",
            "get_cached_json": lambda namespace, cache_key: {"ofacRecordCountTotal": previous_total},
            "SNAPSHOT_STORE": SimpleNamespace(set=lambda *args, **kwargs: None),
        }

    def test_seed_builder_builds_summary_metrics_from_external_sources(self):
        payload = geo_sanctions_shock_service.build_geo_sanctions_shock_seed_payload(
            self.make_context(requests_lib=FakeRequests()),
            previous={"ofacRecordCountTotal": 3},
        )

        self.assertEqual("ok", payload["status"])
        self.assertEqual(1, payload["summary"]["hotspotCount"])
        self.assertEqual(3, payload["summary"]["newSanctionsCount"])
        self.assertIn("IRAN", payload["summary"]["targetLabels"])
        self.assertEqual("elevated", payload["summary"]["nuclearRisk"])
        self.assertEqual("active", payload["summary"]["militaryFeed"])
        self.assertTrue(payload["items"])
        self.assertEqual([], payload["linkedMarkets"])

    def test_seed_builder_returns_renderable_degraded_payload_when_sources_fail(self):
        def broken_http_json_get(url, params=None, timeout=12, headers=None):
            raise RuntimeError("upstream down")

        ctx = self.make_context(requests_lib=None, conflict_url="")
        ctx["http_json_get"] = broken_http_json_get

        payload = geo_sanctions_shock_service.build_geo_sanctions_shock_seed_payload(ctx, previous={})

        self.assertEqual("degraded", payload["status"])
        self.assertEqual([], payload["items"])
        self.assertEqual("requests-missing", payload["sources"]["ofacSdn"])
        self.assertEqual("missing-url", payload["sources"]["conflictFeed"])


class GeoSanctionsShockSnapshotReadPathTestCase(unittest.TestCase):
    def make_context(self, *, redis_payload: Dict[str, Any] | None = None, stale_payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
        settings = SimpleNamespace(
            geo_shock_source_url="https://ofac.treasury.gov/sanctions-list-service",
            geo_shock_ttl_seconds=900,
        )
        snapshot_dir = tempfile.TemporaryDirectory()
        self.addCleanup(snapshot_dir.cleanup)
        store = SnapshotStore(str(Path(snapshot_dir.name) / "snapshots.sqlite3"))
        if stale_payload is not None:
            store.set(
                geo_sanctions_shock_service.GEO_SHOCK_SNAPSHOT_NAMESPACE,
                geo_sanctions_shock_service.GEO_SHOCK_CACHE_KEY,
                stale_payload,
                1,
            )
        redis_cache: Dict[tuple[str, str], Dict[str, Any]] = {}
        if redis_payload is not None:
            redis_cache[(geo_sanctions_shock_service.GEO_SHOCK_SNAPSHOT_NAMESPACE, geo_sanctions_shock_service.GEO_SHOCK_CACHE_KEY)] = redis_payload
        return {
            "SETTINGS": settings,
            "app": FakeApp(),
            "SNAPSHOT_STORE": store,
            "get_cached_json": lambda namespace, cache_key: redis_cache.get((namespace, cache_key)),
            "set_cached_json": lambda namespace, cache_key, payload, ttl_seconds: redis_cache.__setitem__((namespace, cache_key), payload),
            "utc_now_iso": lambda: "2026-04-28T00:00:00Z",
        }

    def test_snapshot_reads_seeded_payload_from_redis_without_building_live_sources(self):
        seeded = {
            "status": "ok",
            "summary": {"targetSummary": "IRAN / CHINA", "newSanctionsCount": 4},
            "items": [{"id": "seed-1"}, {"id": "seed-2"}],
            "linkedMarkets": [],
        }
        ctx = self.make_context(redis_payload=seeded)

        payload = geo_sanctions_shock_service.get_geo_sanctions_shock_snapshot(ctx, limit=1)

        self.assertEqual("ok", payload["status"])
        self.assertEqual(1, len(payload["items"]))
        self.assertEqual("IRAN / CHINA", payload["summary"]["targetSummary"])

    def test_snapshot_uses_stale_payload_when_no_fresh_seed_exists(self):
        stale = {
            "status": "ok",
            "summary": {"targetSummary": "IRAN / RUSSIA"},
            "items": [{"id": "stale-1", "headline": "Stale item"}],
            "linkedMarkets": [],
        }
        ctx = self.make_context(stale_payload=stale)

        payload = geo_sanctions_shock_service.get_geo_sanctions_shock_snapshot(ctx, limit=4)

        self.assertEqual("IRAN / RUSSIA", payload["summary"]["targetSummary"])
        self.assertEqual(stale["items"], payload["items"])

    def test_snapshot_returns_warming_fallback_when_no_seed_exists(self):
        ctx = self.make_context()

        payload = geo_sanctions_shock_service.get_geo_sanctions_shock_snapshot(ctx, limit=4)

        self.assertEqual("degraded", payload["status"])
        self.assertEqual("warming", payload["sources"]["ofacSdn"])
        self.assertEqual([], payload["items"])

    def test_runtime_panel_route_clamps_invalid_and_large_limits(self):
        seen_limits = []
        app = Flask(__name__)
        helpers = {
            "COMMODITY_SYMBOLS": [],
            "CRYPTO_SYMBOLS": [],
            "get_market_group_snapshot": lambda symbols, kind: {"kind": kind, "items": symbols},
            "get_f1_panel_snapshot": lambda limit=10: {"limit": limit},
            "get_geo_sanctions_shock_snapshot": lambda limit=6: seen_limits.append(limit) or {"limit": limit},
            "get_jin10_panel_snapshot": lambda limit=24: {"limit": limit},
            "get_nba_scoreboard_snapshot": lambda limit=10: {"limit": limit},
            "get_nba_intel_snapshot": lambda limit=12: {"limit": limit},
            "get_nba_matchup_predictor_snapshot": lambda limit=8: {"limit": limit},
            "get_inflation_nowcast_snapshot": lambda: {"items": []},
            "get_alpha_signal_snapshot": lambda limit=8: {"limit": limit},
            "get_crypto_funding_watch_snapshot": lambda limit=16: {"limit": limit},
            "get_whale_trades_snapshot": lambda limit=14: {"limit": limit},
            "get_suspicious_trades_snapshot": lambda limit=12: {"limit": limit},
            "get_new_market_signals_snapshot": lambda limit=12: {"limit": limit},
        }
        app.register_blueprint(create_runtime_panels_blueprint(helpers))

        with app.test_client() as client:
            invalid = client.get("/runtime/world/geo-sanctions-shock?limit=oops")
            large = client.get("/runtime/world/geo-sanctions-shock?limit=999")

        self.assertEqual(200, invalid.status_code)
        self.assertEqual(200, large.status_code)
        self.assertEqual([6, 12], seen_limits)


class GeoSanctionsShockWatcherTestCase(unittest.TestCase):
    def make_watcher(self) -> GeoSanctionsShockWatcher:
        watcher = GeoSanctionsShockWatcher.__new__(GeoSanctionsShockWatcher)
        watcher.settings = SimpleNamespace(geo_shock_ttl_seconds=900)
        watcher.redis_prefix = "polydata:"
        watcher.redis_client = FakeRedis()
        snapshot_dir = tempfile.TemporaryDirectory()
        self.addCleanup(snapshot_dir.cleanup)
        watcher.snapshot_store = SnapshotStore(str(Path(snapshot_dir.name) / "watcher.sqlite3"))
        watcher.requests = FakeRequests()
        watcher._http_json_get = lambda url, params=None, timeout=15, headers=None: {
            "fr-url": {"results": []},
            "conflict-url": {
                "items": [
                    {
                        "id": "evt-1",
                        "headline": "Missile strike near Iranian nuclear site",
                        "country": "Iran",
                        "event_date": "2026-04-25T00:00:00Z",
                        "tags": ["military", "nuclear"],
                        "source": "WorldMonitor",
                    }
                ]
            },
        }[url]
        watcher.settings.geo_shock_ofac_sdn_url = "sdn-url"
        watcher.settings.geo_shock_ofac_consolidated_url = "cons-url"
        watcher.settings.geo_shock_federal_register_api_url = "fr-url"
        watcher.settings.geo_shock_conflict_api_url = "conflict-url"
        watcher.settings.geo_shock_source_url = "https://ofac.treasury.gov/sanctions-list-service"
        return watcher

    def test_watcher_stores_payload_into_redis_and_snapshot_store(self):
        watcher = self.make_watcher()

        result = watcher.run_once()

        self.assertEqual("stored", result["status"])
        raw = watcher.redis_client.get(watcher.redis_key())
        self.assertIsNotNone(raw)
        parsed = json.loads(str(raw))
        self.assertEqual("seeded", parsed["cacheMode"])
        self.assertIsNotNone(
            watcher.snapshot_store.get(
                geo_sanctions_shock_service.GEO_SHOCK_SNAPSHOT_NAMESPACE,
                geo_sanctions_shock_service.GEO_SHOCK_CACHE_KEY,
            )
        )

    def test_watcher_preserves_previous_payload_when_new_result_has_no_material_signal(self):
        watcher = self.make_watcher()
        previous = {
            "status": "ok",
            "summary": {"targetSummary": "IRAN / RUSSIA", "targetLabels": ["IRAN", "RUSSIA"], "newSanctionsCount": 2, "hotspotCount": 1, "nuclearRisk": "elevated", "militaryFeed": "active"},
            "items": [{"id": "seed-1"}],
            "linkedMarkets": [],
        }
        watcher.store_payload(previous)
        watcher.requests = None
        watcher._http_json_get = lambda *args, **kwargs: {"results": []}
        watcher.build_payload = lambda: {
            "status": "degraded",
            "summary": {
                "hotspotCount": 0,
                "newSanctionsCount": 0,
                "targetLabels": [],
                "targetSummary": "MONITORING",
                "nuclearRisk": "guarded",
                "militaryFeed": "standby",
            },
            "items": [],
            "linkedMarkets": [],
        }

        result = watcher.run_once()

        self.assertEqual("preserved", result["status"])
        raw = watcher.redis_client.get(watcher.redis_key())
        self.assertEqual(previous["summary"]["targetSummary"], json.loads(str(raw))["summary"]["targetSummary"])
