from __future__ import annotations

import sys
import unittest
from pathlib import Path

from flask import Flask


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.routes.market_groups import create_market_groups_blueprint
from api.services import market_group_service


class FakeSettings:
    gamma_api_base = "https://gamma.example"


class FakeLogger:
    def exception(self, *args, **kwargs) -> None:
        return None


class FakeApp:
    logger = FakeLogger()


class MarketGroupServiceTestCase(unittest.TestCase):
    def make_ctx(self, events):
        runtime_cache = {}
        snapshot_cache = {}

        def get_cached_runtime_payload(namespace, cache_key):
            return runtime_cache.get((namespace, cache_key))

        def set_cached_runtime_payload(namespace, cache_key, payload, ttl_seconds=30):
            runtime_cache[(namespace, cache_key)] = payload
            return payload

        def get_snapshot_payload(namespace, cache_key, builder, ttl_seconds=30):
            del ttl_seconds
            value = snapshot_cache.get((namespace, cache_key))
            if value is not None:
                return value
            payload = builder()
            snapshot_cache[(namespace, cache_key)] = payload
            return payload

        def query_all(sql, params):
            del sql
            rows = []
            values = {str(value).lower() for value in params}
            if "cond-1" in values:
                rows.append(
                    {
                        "id": 101,
                        "slug": "jd-vance-wins",
                        "title": "Will JD Vance win?",
                        "condition_key": "cond-1",
                        "slug_key": "jd-vance-wins",
                        "yes_token_id": "yes-1",
                        "latest_yes_price": "0.19",
                        "latest_no_price": "0.81",
                        "volume_24h": "1000",
                        "trade_count_24h": 12,
                        "last_trade_at": "2026-04-27T00:00:00Z",
                        "price_24h_ago": "0.18",
                    }
                )
            return rows

        def http_json_get(url, params=None, **kwargs):
            del url, kwargs
            params = params or {}
            event_id = str(params.get("id") or "").strip()
            slug = str(params.get("slug") or "").strip()
            if event_id:
                return [event for event in events if str(event.get("id")) == event_id]
            if slug:
                return [event for event in events if str(event.get("slug")) == slug]
            return events

        return {
            "SETTINGS": FakeSettings(),
            "app": FakeApp(),
            "get_cached_runtime_payload": get_cached_runtime_payload,
            "get_snapshot_payload": get_snapshot_payload,
            "set_cached_runtime_payload": set_cached_runtime_payload,
            "get_market_clob_price_series": lambda market, range_name="1d", interval="15m": [
                {"timestamp": "2026-04-27T00:00:00Z", "yesPrice": "0.20", "noPrice": "0.80"},
                {"timestamp": "2026-04-27T01:00:00Z", "yesPrice": "0.21", "noPrice": "0.79"},
            ]
            if str(market.get("yes_token_id") or "")
            else [],
            "http_json_get": http_json_get,
            "query_all": query_all,
            "utc_now_iso": lambda: "2026-04-27T12:00:00Z",
        }

    def test_groups_preserve_multi_outcomes_and_local_market_match(self):
        ctx = self.make_ctx(
            [
                {
                    "id": "event-1",
                    "title": "Presidential Election Winner 2028",
                    "slug": "presidential-election-winner-2028",
                    "active": True,
                    "closed": False,
                    "volume24hr": 50000,
                    "tags": [{"label": "Elections"}],
                    "markets": [
                        {
                            "id": "gamma-1",
                            "question": "Will JD Vance win the 2028 presidential election?",
                            "groupItemTitle": "JD Vance",
                            "conditionId": "cond-1",
                            "clobTokenIds": ["yes-1", "no-1"],
                            "outcomePrices": ["0.18", "0.82"],
                        },
                        {
                            "id": "gamma-2",
                            "question": "Will Gavin Newsom win the 2028 presidential election?",
                            "groupItemTitle": "Gavin Newsom",
                            "conditionId": "cond-2",
                            "outcomePrices": ["0.17", "0.83"],
                        },
                    ],
                }
            ]
        )

        payload = market_group_service.get_market_groups_payload(ctx, page_size=20)

        self.assertEqual(1, len(payload["items"]))
        group = payload["items"][0]
        self.assertEqual("event:event-1", group["groupId"])
        self.assertEqual(2, group["outcomeCount"])
        self.assertEqual(101, group["defaultMarketId"])
        self.assertEqual("JD Vance", group["topOutcomes"][0]["label"])
        self.assertEqual(101, group["outcomes"][0]["marketId"])

    def test_filters_noisy_and_terminal_events(self):
        ctx = self.make_ctx(
            [
                {
                    "id": "noisy",
                    "title": "Bitcoin Up or Down - April 27",
                    "active": True,
                    "closed": False,
                    "markets": [{"id": "m1", "outcomePrices": ["0.50", "0.50"]}],
                },
                {
                    "id": "terminal",
                    "title": "Resolved style event",
                    "active": True,
                    "closed": False,
                    "markets": [{"id": "m2", "outcomePrices": ["0.999", "0.001"]}],
                },
                {
                    "id": "hidden",
                    "title": "2026 FIFA World Cup Winner",
                    "active": True,
                    "closed": False,
                    "tags": [{"label": "Hide From New"}],
                    "markets": [{"id": "m3", "outcomePrices": ["0.5", "0.5"]}],
                },
            ]
        )

        payload = market_group_service.get_market_groups_payload(ctx, page_size=20)

        self.assertEqual([], payload["items"])

    def test_new_sort_uses_created_at(self):
        ctx = self.make_ctx(
            [
                {"id": "old", "title": "Old", "active": True, "closed": False, "createdAt": "2026-04-01T00:00:00Z", "markets": [{"id": "m1", "outcomePrices": ["0.4", "0.6"]}]},
                {"id": "new", "title": "New", "active": True, "closed": False, "createdAt": "2026-04-27T00:00:00Z", "markets": [{"id": "m2", "outcomePrices": ["0.4", "0.6"]}]},
            ]
        )

        payload = market_group_service.get_market_groups_payload(ctx, page_size=20, sort="new")

        self.assertEqual(["event:new", "event:old"], [item["groupId"] for item in payload["items"]])

    def test_detail_payload_returns_multi_outcome_group(self):
        ctx = self.make_ctx(
            [
                {
                    "id": "event-1",
                    "title": "Presidential Election Winner 2028",
                    "slug": "presidential-election-winner-2028",
                    "active": True,
                    "closed": False,
                    "volume24hr": 50000,
                    "tags": [{"label": "Elections"}],
                    "markets": [
                        {
                            "id": "gamma-1",
                            "question": "Will JD Vance win the 2028 presidential election?",
                            "groupItemTitle": "JD Vance",
                            "conditionId": "cond-1",
                            "clobTokenIds": ["yes-1", "no-1"],
                            "outcomePrices": ["0.18", "0.82"],
                        },
                        {
                            "id": "gamma-2",
                            "question": "Will Gavin Newsom win the 2028 presidential election?",
                            "groupItemTitle": "Gavin Newsom",
                            "conditionId": "cond-2",
                            "clobTokenIds": ["yes-2", "no-2"],
                            "outcomePrices": ["0.17", "0.83"],
                        },
                    ],
                }
            ]
        )

        payload = market_group_service.get_market_group_detail_payload(ctx, "event-1")

        self.assertIsNotNone(payload)
        self.assertEqual("Presidential Election Winner 2028", payload["title"])
        self.assertEqual("jd-vance", payload["defaultOutcomeKey"])
        self.assertEqual(2, len(payload["outcomes"]))

    def test_chart_payload_returns_multiple_series(self):
        ctx = self.make_ctx(
            [
                {
                    "id": "event-1",
                    "title": "Presidential Election Winner 2028",
                    "slug": "presidential-election-winner-2028",
                    "active": True,
                    "closed": False,
                    "volume24hr": 50000,
                    "tags": [{"label": "Elections"}],
                    "markets": [
                        {
                            "id": "gamma-1",
                            "question": "Will JD Vance win the 2028 presidential election?",
                            "groupItemTitle": "JD Vance",
                            "conditionId": "cond-1",
                            "clobTokenIds": ["yes-1", "no-1"],
                            "outcomePrices": ["0.18", "0.82"],
                        },
                        {
                            "id": "gamma-2",
                            "question": "Will Gavin Newsom win the 2028 presidential election?",
                            "groupItemTitle": "Gavin Newsom",
                            "conditionId": "cond-2",
                            "clobTokenIds": ["yes-2", "no-2"],
                            "outcomePrices": ["0.17", "0.83"],
                        },
                    ],
                }
            ]
        )

        payload = market_group_service.get_market_group_chart_payload(ctx, "event-1", range_name="1w")

        self.assertIsNotNone(payload)
        self.assertEqual("1w", payload["range"])
        self.assertEqual("1h", payload["interval"])
        self.assertEqual(2, len(payload["series"]))
        self.assertEqual("JD Vance", payload["series"][0]["label"])
        self.assertEqual(2, len(payload["series"][0]["points"]))

    def test_groups_payload_degrades_when_gamma_fetch_fails(self):
        ctx = self.make_ctx([])
        ctx["http_json_get"] = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("gamma down"))

        payload = market_group_service.get_market_groups_payload(ctx, page_size=20)

        self.assertEqual([], payload["items"])
        self.assertEqual("degraded", payload["status"])


class MarketGroupRouteTestCase(unittest.TestCase):
    def test_detail_and_chart_routes_return_json(self):
        app = Flask(__name__)
        app.register_blueprint(
            create_market_groups_blueprint(
                {
                    "get_market_groups_payload": lambda **kwargs: {"items": [], "pagination": {"page": 1, "pageSize": 80, "hasMore": False}},
                    "get_market_group_detail_payload": lambda event_id: {"eventId": event_id, "title": "Demo event", "outcomes": []},
                    "get_market_group_chart_payload": lambda event_id, range_name="1d": {"eventId": event_id, "range": range_name, "series": []},
                }
            )
        )

        with app.test_client() as client:
            detail = client.get("/market-groups/event-1/detail")
            chart = client.get("/market-groups/event-1/chart?range=1w")

        self.assertEqual(200, detail.status_code)
        self.assertEqual("Demo event", detail.get_json()["title"])
        self.assertEqual(200, chart.status_code)
        self.assertEqual("1w", chart.get_json()["range"])


if __name__ == "__main__":
    unittest.main()
