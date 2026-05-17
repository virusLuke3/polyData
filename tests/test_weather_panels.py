from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.services import global_weather_map_service, weather_news_service
from runtime import global_weather_map_watcher, weather_news_watcher
from weather.cities import WEATHER_CITIES


class FakeLogger:
    def exception(self, *args, **kwargs):
        return None

    def info(self, *args, **kwargs):
        return None

    def warning(self, *args, **kwargs):
        return None


class FakeStore:
    def __init__(self, payload=None, stale=None):
        self.payload = payload
        self.stale = stale
        self.set_calls = []

    def get(self, namespace, cache_key):
        return self.payload

    def get_stale(self, namespace, cache_key):
        return self.stale

    def set(self, namespace, cache_key, payload, ttl):
        self.set_calls.append((namespace, cache_key, payload, ttl))
        self.payload = payload


def test_weather_city_watchlist_matches_polyweather_reference():
    expected = [
        "New York",
        "Chicago",
        "Dallas",
        "Miami",
        "Austin",
        "Atlanta",
        "Houston",
        "Denver",
        "Mexico City",
        "Los Angeles",
        "Seattle",
        "Toronto",
        "London",
        "Paris",
        "Madrid",
        "Milan",
        "Munich",
        "Warsaw",
        "Amsterdam",
        "Tel Aviv",
        "Ankara",
        "Beijing",
        "Shanghai",
        "Shenzhen",
        "Singapore",
        "Tokyo",
        "Seoul",
        "Chengdu",
        "Chongqing",
        "Wuhan",
        "Buenos Aires",
        "Sao Paulo",
        "Wellington",
    ]

    assert [city["city"] for city in WEATHER_CITIES] == expected
    assert len(WEATHER_CITIES) == 33


def make_settings(**kwargs):
    defaults = {
        "open_meteo_api_url": "https://open.example/forecast",
        "aviationweather_metar_api_url": "https://aviation.example/metar",
        "google_news_rss_url": "https://news.example/rss/search",
        "weather_source_url": "https://weather.example",
        "gamma_api_base": "https://gamma.example",
        "clob_api_base": "https://clob.example",
        "clob_timeout_seconds": 2,
        "global_weather_map_ttl_seconds": 300,
        "global_weather_market_days": 4,
        "weather_news_ttl_seconds": 900,
        "weather_news_limit": 40,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def make_ctx(http_json_get=None, http_text_get=None, store=None, cached=None):
    calls = {"json": 0, "text": 0, "set_cache": 0}

    def json_get(*args, **kwargs):
        calls["json"] += 1
        if http_json_get:
            return http_json_get(*args, **kwargs)
        raise RuntimeError("network disabled")

    def text_get(*args, **kwargs):
        calls["text"] += 1
        if http_text_get:
            return http_text_get(*args, **kwargs)
        raise RuntimeError("network disabled")

    ctx = {
        "SETTINGS": make_settings(),
        "app": SimpleNamespace(logger=FakeLogger()),
        "utc_now_iso": lambda: "2026-05-12T12:00:00Z",
        "http_json_get": json_get,
        "http_text_get": text_get,
        "SNAPSHOT_STORE": store,
        "get_cached_json": lambda namespace, cache_key: cached,
        "set_cached_json": lambda *args: calls.__setitem__("set_cache", calls["set_cache"] + 1),
        "_calls": calls,
    }
    return ctx


def test_global_weather_map_builds_weather_metar_and_market_payload(monkeypatch):
    monkeypatch.setattr(global_weather_map_service, "_clob_yes_quote", lambda ctx, market: {"bestBidYes": 0.31, "bestAskYes": 0.35})

    def http_json_get(url, *, params=None, **kwargs):
        if "open.example" in url:
            return [
                {
                    "current": {"temperature_2m": 22.0, "weather_code": 2, "time": "2026-05-12T12:00"},
                    "hourly": {"time": ["2026-05-12T12:00"], "temperature_2m": [22.0]},
                    "daily": {"time": ["2026-05-12"], "temperature_2m_max": [27.0], "temperature_2m_min": [16.0]},
                }
            ]
        if "aviation.example" in url:
            return [{"icaoId": "KNYC", "temp": 21, "reportTime": "2026-05-12T11:50:00Z"}]
        if "gamma.example" in url:
            return [
                {
                    "id": "evt-1",
                    "slug": "highest-temperature-in-new-york-on-may-12-2026",
                    "title": "Highest temperature in New York on May 12?",
                    "active": True,
                    "closed": False,
                    "markets": [
                        {"id": "m1", "question": "Highest temperature in New York on May 12? 80°F or higher", "slug": "ny-80", "outcomePrices": ["0.30", "0.70"], "active": True}
                    ],
                }
            ]
        if "clob.example" in url:
            return {"bids": [{"price": "0.31"}], "asks": [{"price": "0.35"}]}
        return []

    ctx = make_ctx(http_json_get=http_json_get)
    payload = global_weather_map_service.build_global_weather_map_payload(ctx, limit=1)

    assert payload["status"] == "ok"
    assert payload["summary"]["mappedCount"] == 1
    assert payload["summary"]["liveMarketCount"] == 1
    city = payload["items"][0]
    assert city["cityId"] == "new-york"
    assert city["currentTemp"] == 71.6
    assert city["metarTemp"] == 69.8
    assert city["quoteCoverage"] == "1/1"
    assert city["topBin"]["midPriceYes"] == 0.33


def test_global_weather_map_seeded_snapshot_does_not_live_fetch():
    seeded = {"generatedAt": "2026-05-12T00:00:00Z", "status": "ok", "items": [{"cityId": "seed", "city": "Seed"}], "summary": {"cityCount": 1, "mappedCount": 1}}
    ctx = make_ctx(cached=seeded)
    payload = global_weather_map_service.get_global_weather_map_snapshot(ctx, limit=1)

    assert payload["cacheMode"] == "redis-seed"
    assert payload["items"][0]["city"] == "Seed"
    assert ctx["_calls"]["json"] == 0


def test_global_weather_map_failure_returns_warming_payload():
    ctx = make_ctx()
    payload = global_weather_map_service.get_global_weather_map_snapshot(ctx, limit=1, allow_live_build=False)

    assert payload["status"] == "warming"
    assert payload["items"] == []
    assert payload["cacheMode"] == "seed-miss"


def test_global_weather_map_cold_start_returns_fast_and_schedules_refresh(monkeypatch):
    scheduled = {}

    def schedule(ctx, *, limit, ttl_seconds, reason):
        scheduled.update({"limit": limit, "ttl": ttl_seconds, "reason": reason})
        return True

    monkeypatch.setattr(global_weather_map_service, "_schedule_live_refresh", schedule)
    ctx = make_ctx()
    payload = global_weather_map_service.get_global_weather_map_snapshot(ctx, limit=2)

    assert payload["status"] == "warming"
    assert payload["items"] == []
    assert payload["cacheMode"] == "seed-miss-refreshing"
    assert scheduled == {"limit": 2, "ttl": 300, "reason": "seed-miss"}
    assert ctx["_calls"]["json"] == 0


def test_global_weather_map_market_discovery_is_city_tolerant(monkeypatch):
    monkeypatch.setattr(global_weather_map_service, "_clob_yes_quote", lambda ctx, market: {"bestBidYes": 0.41, "bestAskYes": 0.45})

    def http_json_get(url, *, params=None, **kwargs):
        if "open.example" in url:
            return [
                {
                    "current": {"temperature_2m": 22.0, "weather_code": 2, "time": "2026-05-12T12:00"},
                    "hourly": {"time": ["2026-05-12T12:00"], "temperature_2m": [22.0]},
                    "daily": {"time": ["2026-05-12"], "temperature_2m_max": [27.0], "temperature_2m_min": [16.0]},
                },
                {
                    "current": {"temperature_2m": 18.0, "weather_code": 1, "time": "2026-05-12T12:00"},
                    "hourly": {"time": ["2026-05-12T12:00"], "temperature_2m": [18.0]},
                    "daily": {"time": ["2026-05-12"], "temperature_2m_max": [24.0], "temperature_2m_min": [14.0]},
                },
            ]
        if "aviation.example" in url:
            return [{"icaoId": "KNYC", "temp": 21, "reportTime": "2026-05-12T11:50:00Z"}]
        if "gamma.example" in url:
            query = str((params or {}).get("q") or "")
            if "Chicago" in query:
                raise RuntimeError("gamma temporary miss")
            return [
                {
                    "id": "evt-1",
                    "slug": "highest-temperature-in-new-york-on-may-12-2026",
                    "title": "Highest temperature in New York on May 12?",
                    "active": True,
                    "closed": False,
                    "markets": [
                        {"id": "m1", "question": "Highest temperature in New York on May 12? 80°F or higher", "slug": "ny-80", "outcomePrices": ["0.40", "0.60"], "active": True}
                    ],
                }
            ]
        return []

    ctx = make_ctx(http_json_get=http_json_get)
    payload = global_weather_map_service.build_global_weather_map_payload(ctx, limit=2)
    by_city = {item["cityId"]: item for item in payload["items"]}

    assert payload["summary"]["mappedCount"] == 2
    assert payload["summary"]["liveMarketCount"] == 1
    assert payload["sources"]["gamma"] == "partial"
    assert by_city["new-york"]["sourceStates"]["polymarket"] == "ok"
    assert by_city["chicago"]["sourceStates"]["polymarket"] == "error"


def test_weather_news_builds_filters_dedupes_and_ranks():
    rss = """<?xml version="1.0"?><rss><channel>
      <item><title>New York weather warning: heavy rain</title><link>https://news.example/a</link><source>WX News</source><pubDate>Tue, 12 May 2026 10:00:00 GMT</pubDate><description>Storm warning and rain forecast.</description></item>
      <item><title>New York sports update</title><link>https://news.example/b</link><source>Sports</source><pubDate>Tue, 12 May 2026 09:00:00 GMT</pubDate><description>Baseball result.</description></item>
    </channel></rss>"""
    ctx = make_ctx(http_text_get=lambda *args, **kwargs: rss)
    payload = weather_news_service.build_weather_news_payload(ctx, limit=3)

    assert payload["status"] == "ok"
    assert payload["summary"]["articleCount"] == 1
    assert payload["items"][0]["severity"] == "warning"
    assert payload["items"][0]["city"] == "New York"


def test_weather_news_seeded_snapshot_does_not_live_fetch():
    seeded = {"generatedAt": "2026-05-12T00:00:00Z", "status": "ok", "items": [{"id": "seed", "title": "Seed weather"}], "summary": {"articleCount": 1}}
    ctx = make_ctx(cached=seeded)
    payload = weather_news_service.get_weather_news_snapshot(ctx, limit=1)

    assert payload["cacheMode"] == "redis-seed"
    assert payload["items"][0]["title"] == "Seed weather"
    assert ctx["_calls"]["text"] == 0


def test_weather_news_bad_xml_degrades_without_items():
    ctx = make_ctx(http_text_get=lambda *args, **kwargs: "<rss>")
    payload = weather_news_service.build_weather_news_payload(ctx, limit=3)

    assert payload["status"] == "degraded"
    assert payload["items"] == []
    assert any(value == "error" for value in payload["sources"].values())


def test_weather_news_filters_sports_storm_false_positives():
    rss = """<?xml version="1.0"?><rss><channel>
      <item><title>Eels v Storm: Moses riding high</title><link>https://news.example/sports</link><source>NRL.com</source><pubDate>Tue, 12 May 2026 10:00:00 GMT</pubDate><description>NRL team news and picks.</description></item>
      <item><title>Melbourne ambush: Storm snap losing streak</title><link>https://news.example/storm-team</link><source>Daily Telegraph Sydney</source><pubDate>Tue, 12 May 2026 09:45:00 GMT</pubDate><description>Emotional Bellamy return.</description></item>
      <item><title>Perth property bloodbath warning amid housing crash</title><link>https://news.example/property</link><source>PerthNow</source><pubDate>Tue, 12 May 2026 09:30:00 GMT</pubDate><description>Property market warning.</description></item>
      <item><title>Johannesburg severe storm disrupts flights</title><link>https://news.example/weather</link><source>Travel Desk</source><pubDate>Tue, 12 May 2026 09:00:00 GMT</pubDate><description>Severe storm and wind delays expected.</description></item>
      <item><title>Chicago weather: Tracking late storm chances</title><link>https://news.example/chicago</link><source>FOX 32 Chicago</source><pubDate>Tue, 12 May 2026 08:00:00 GMT</pubDate><description>Storm chance returns Tuesday.</description></item>
    </channel></rss>"""
    ctx = make_ctx(http_text_get=lambda *args, **kwargs: rss)
    payload = weather_news_service.build_weather_news_payload(ctx, limit=5)

    titles = [item["title"] for item in payload["items"]]
    assert "Johannesburg severe storm disrupts flights" in titles
    assert "Chicago weather: Tracking late storm chances" in titles
    assert all("Eels v Storm" not in title for title in titles)
    assert all("Storm snap losing streak" not in title for title in titles)
    assert all("property bloodbath" not in title for title in titles)


def test_watchers_preserve_previous_on_empty_or_exception(monkeypatch):
    previous_map = {"items": [{"cityId": "new-york"}], "sources": {"openMeteo": "ok"}, "status": "ok"}
    map_watcher = global_weather_map_watcher.GlobalWeatherMapWatcher.__new__(global_weather_map_watcher.GlobalWeatherMapWatcher)
    map_watcher.previous = lambda: previous_map
    map_watcher.context = lambda: {}
    stored = {}
    map_watcher.store_payload = lambda payload: stored.setdefault("map_payload", payload)
    map_watcher.store_meta = lambda **kwargs: stored.setdefault("map_meta", kwargs)
    monkeypatch.setattr(global_weather_map_watcher.global_weather_map_service, "build_global_weather_map_payload", lambda ctx: {"items": [], "sources": {"openMeteo": "empty"}, "status": "empty"})

    result = map_watcher.run_once()

    assert result["status"] == "preserved"
    assert stored["map_payload"] is previous_map
    assert stored["map_meta"]["preserve"] is True

    previous_news = {"items": [{"id": "n1"}], "sources": {"googleNews": "ok"}, "status": "ok"}
    news_watcher = weather_news_watcher.WeatherNewsWatcher.__new__(weather_news_watcher.WeatherNewsWatcher)
    news_watcher.previous = lambda: previous_news
    news_watcher.context = lambda: {}
    news_watcher.settings = make_settings()
    news_watcher.store_payload = lambda payload: stored.setdefault("news_payload", payload)
    news_watcher.store_meta = lambda **kwargs: stored.setdefault("news_meta", kwargs)
    monkeypatch.setattr(weather_news_watcher.weather_news_service, "build_weather_news_payload", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")))

    result = news_watcher.run_once()

    assert result["status"] == "preserved"
    assert stored["news_payload"] is previous_news
    assert stored["news_meta"]["preserve"] is True
