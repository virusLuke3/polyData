from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.runtime_panels.registry import get_panel_by_id
from api.services import tech_panels_service


RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item>
    <title>OpenAI launches new model benchmark push - Reuters</title>
    <link>https://example.com/openai</link>
    <guid>openai-1</guid>
    <pubDate>Sun, 24 May 2026 10:00:00 GMT</pubDate>
    <source>Reuters</source>
    <description>OpenAI model release signal.</description>
  </item>
  <item>
    <title>TikTok app ban lawsuit update - CNBC</title>
    <link>https://example.com/tiktok</link>
    <guid>tiktok-1</guid>
    <pubDate>Sun, 24 May 2026 09:00:00 GMT</pubDate>
    <source>CNBC</source>
    <description>TikTok regulation signal.</description>
  </item>
</channel></rss>
"""


def _ctx():
    def http_text_get(url, timeout=12, headers=None):
        assert "news.google.com" in url
        return RSS_XML

    def http_json_get(url, params=None, timeout=12, headers=None):
        assert "apps/top-free" in url
        return {
            "feed": {
                "results": [
                    {"id": "1", "name": "ChatGPT", "artistName": "OpenAI", "url": "https://apps.apple.com/app/1"},
                    {"id": "2", "name": "TikTok", "artistName": "TikTok Ltd.", "url": "https://apps.apple.com/app/2"},
                ]
            }
        }

    def yahoo(symbol, interval="30m", range_name="5d", ttl_seconds=None):
        prices = {
            "NVDA": (180.0, 4_400_000_000_000, 2.4),
            "AAPL": (220.0, 3_400_000_000_000, -0.5),
            "MSFT": (510.0, 3_800_000_000_000, 0.8),
        }
        price, market_cap, change = prices.get(symbol, (100.0, 1_000_000_000_000, 0.0))
        return {
            "symbol": symbol,
            "price": price,
            "marketCap": market_cap,
            "changePercent": change,
            "points": [{"timestamp": "2026-05-24T00:00:00Z", "value": price}],
        }

    return {
        "SETTINGS": SimpleNamespace(
            tech_runtime_ttl_seconds=600,
            tech_google_news_rss_url="https://news.google.com/rss/search",
            tech_app_store_top_free_url="https://rss.applemarketingtools.com/api/v2/us/apps/top-free/25/apps.json",
        ),
        "http_text_get": http_text_get,
        "http_json_get": http_json_get,
        "get_yahoo_market_snapshot": yahoo,
        "utc_now_iso": lambda: "2026-05-24T00:00:00Z",
    }


def test_tech_runtime_panels_are_registered():
    assert get_panel_by_id("ai-model-race").route == "/runtime/tech/ai-model-race"
    assert get_panel_by_id("big-tech-market-cap").route == "/runtime/tech/big-tech-market-cap"
    assert get_panel_by_id("consumer-app-pulse").route == "/runtime/tech/consumer-app-pulse"


def test_ai_model_race_payload_extracts_entity_and_tags():
    payload = tech_panels_service.build_tech_panel_payload(_ctx(), "ai-model-race", limit=6)

    assert payload["status"] == "ok"
    assert payload["items"][0]["label"] == "OpenAI"
    assert "RELEASE" in payload["items"][0]["tags"]
    assert payload["summary"]["watchlist"][0]["count"] >= 1


def test_big_tech_market_cap_payload_ranks_by_market_cap():
    payload = tech_panels_service.build_tech_panel_payload(_ctx(), "big-tech-market-cap", limit=3)

    assert payload["status"] == "ok"
    assert payload["items"][0]["symbol"] == "NVDA"
    assert payload["items"][0]["metricUnit"] == "MKT CAP"
    assert payload["items"][0]["rank"] == 1


def test_consumer_app_pulse_combines_app_store_and_news():
    payload = tech_panels_service.build_tech_panel_payload(_ctx(), "consumer-app-pulse", limit=6)

    assert payload["status"] == "ok"
    assert payload["sources"]["appStore"] == "ok"
    assert payload["items"][0]["source"] == "App Store"
    assert any(item["label"] == "TikTok" for item in payload["items"])
