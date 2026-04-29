from __future__ import annotations

import sys
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


class GeoSanctionsShockServiceTestCase(unittest.TestCase):
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
            "get_cached_runtime_payload": lambda namespace, cache_key: {"ofacRecordCountTotal": previous_total},
            "SNAPSHOT_STORE": SimpleNamespace(get=lambda *args, **kwargs: None, get_stale=lambda *args, **kwargs: None),
            "get_snapshot_payload": lambda namespace, cache_key, builder, ttl_seconds=900: builder(),
            "utc_now_iso": lambda: "2026-04-28T00:00:00Z",
        }

    def test_snapshot_builds_summary_metrics_from_external_sources(self):
        payload = geo_sanctions_shock_service.get_geo_sanctions_shock_snapshot(
            self.make_context(requests_lib=FakeRequests()),
            limit=5,
        )

        self.assertEqual("ok", payload["status"])
        self.assertEqual(1, payload["summary"]["hotspotCount"])
        self.assertEqual(3, payload["summary"]["newSanctionsCount"])
        self.assertIn("IRAN", payload["summary"]["targetLabels"])
        self.assertEqual("elevated", payload["summary"]["nuclearRisk"])
        self.assertEqual("active", payload["summary"]["militaryFeed"])
        self.assertTrue(payload["items"])
        self.assertEqual([], payload["linkedMarkets"])

    def test_snapshot_returns_renderable_degraded_payload_when_sources_fail(self):
        def broken_http_json_get(url, params=None, timeout=12, headers=None):
            raise RuntimeError("upstream down")

        ctx = self.make_context(requests_lib=None, conflict_url="")
        ctx["http_json_get"] = broken_http_json_get

        payload = geo_sanctions_shock_service.get_geo_sanctions_shock_snapshot(ctx, limit=4)

        self.assertEqual("degraded", payload["status"])
        self.assertEqual([], payload["items"])
        self.assertEqual("requests-missing", payload["sources"]["ofacSdn"])
        self.assertEqual("missing-url", payload["sources"]["conflictFeed"])

    def test_snapshot_can_preserve_stale_payload_when_builder_returns_no_items(self):
        stale = {
            "status": "ok",
            "summary": {"targetSummary": "IRAN / RUSSIA"},
            "items": [{"id": "stale-1", "headline": "Stale item"}],
            "linkedMarkets": [],
        }
        ctx = self.make_context(requests_lib=None, conflict_url="")
        ctx["http_json_get"] = lambda *args, **kwargs: {"results": []}
        ctx["get_snapshot_payload"] = lambda namespace, cache_key, builder, ttl_seconds=900: stale if not builder().get("items") else builder()

        payload = geo_sanctions_shock_service.get_geo_sanctions_shock_snapshot(ctx, limit=4)

        self.assertEqual(stale, payload)

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


if __name__ == "__main__":
    unittest.main()
