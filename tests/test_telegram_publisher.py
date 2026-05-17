from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from telegram.api_client import resolve_polydata_api_base
from telegram.config import TelegramSettings, TopicConfig
from telegram.formatters import format_nba_scoreboard, format_panel_snapshot, format_weather_map, format_weather_news
from telegram.models import MessageCandidate
from telegram.publisher import publish_candidates
from telegram.state import PublishState


class FakeTelegram:
    def __init__(self) -> None:
        self.calls = []

    def send_message(self, **kwargs):
        self.calls.append(kwargs)
        return [{"ok": True}]


def make_settings(state_path: str) -> TelegramSettings:
    return TelegramSettings(
        bot_token="token",
        telegram_api_base="https://api.telegram.org",
        polydata_api_base="http://127.0.0.1:18500",
        polydata_api_candidates=("http://127.0.0.1:18500",),
        state_path=state_path,
        request_timeout_seconds=12,
        watch_interval_seconds=60,
        dry_run=False,
        disable_notification=False,
        publish_on_api_fetch=False,
        news=TopicConfig(name="news", chat_id="@news"),
        alpha=TopicConfig(name="alpha", chat_id="@alpha"),
        macro=TopicConfig(name="macro", chat_id="@macro"),
        nba=TopicConfig(name="nba", chat_id="@nba"),
        weather=TopicConfig(name="weather", chat_id="@weather"),
        monitor=TopicConfig(name="monitor", chat_id="@monitor"),
    )


def test_nba_scoreboard_formatter_keys_score_changes():
    first = {
        "items": [
            {
                "id": "game-1",
                "awayTeam": "Lakers",
                "homeTeam": "Rockets",
                "awayScore": "101",
                "homeScore": "99",
                "status": "Final",
                "state": "post",
            }
        ]
    }
    second = {"items": [{**first["items"][0], "homeScore": "100"}]}

    first_message = format_nba_scoreboard(first)[0]
    second_message = format_nba_scoreboard(second)[0]

    assert "Lakers 101 @ Rockets 99" in first_message.text
    assert first_message.priority == "high"
    assert first_message.dedupe_key != second_message.dedupe_key


def test_weather_formatters_emit_market_and_warning_only():
    weather_map = {
        "summary": {
            "liveMarketCount": 1,
            "hottestCity": {"city": "Phoenix", "currentTemp": 102.1, "forecastHigh": 108.0},
        },
        "items": [
            {
                "cityId": "phoenix",
                "city": "Phoenix",
                "currentTemp": 102.1,
                "eventSlug": "phoenix-temp",
                "marketUrl": "https://polymarket.com/event/phoenix-temp",
                "quoteCoverage": "3/3",
                "topBin": {"label": "110F or higher", "midPriceYes": 0.37},
            }
        ],
    }
    news = {
        "items": [
            {"id": "n1", "title": "Phoenix heat warning", "severity": "warning", "city": "Phoenix", "source": "WX", "url": "https://news.example/1"},
            {"id": "n2", "title": "Mild forecast", "severity": "normal", "city": "Boston"},
        ]
    }

    map_messages = format_weather_map(weather_map)
    news_messages = format_weather_news(news)

    assert len(map_messages) == 2
    assert any(message.priority == "high" and "YES 37c" in message.text for message in map_messages)
    assert len(news_messages) == 1
    assert news_messages[0].priority == "high"


def test_publish_state_dedupes_and_dry_run_does_not_mark(tmp_path: Path):
    state_path = str(tmp_path / "telegram_state.json")
    settings = make_settings(state_path)
    state = PublishState(state_path)
    telegram = FakeTelegram()
    candidate = MessageCandidate(topic="nba", dedupe_key="same", text="hello")

    dry_result = publish_candidates([candidate], settings=settings, state=state, telegram=telegram, dry_run=True)
    assert dry_result.sent == 1
    assert not state.seen("nba", "same")
    assert telegram.calls == []

    first = publish_candidates([candidate], settings=settings, state=state, telegram=telegram)
    second = publish_candidates([candidate], settings=settings, state=state, telegram=telegram)

    assert first.sent == 1
    assert second.sent == 0
    assert second.skipped_seen == 1
    assert telegram.calls[0]["chat_id"] == "@nba"


class FakeHealthResponse:
    def __init__(self, payload, *, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class FakeHealthSession:
    def __init__(self):
        self.calls = []

    def get(self, url, timeout):
        self.calls.append((url, timeout))
        if "bad" in url:
            raise RuntimeError("connection refused")
        return FakeHealthResponse({"status": "ok"})


def test_resolve_polydata_api_base_skips_dead_local_and_uses_remote():
    session = FakeHealthSession()
    resolution = resolve_polydata_api_base(
        ["http://bad.local:5000", "http://remote.example/wm-api"],
        timeout_seconds=2,
        session=session,
    )

    assert resolution.healthy is True
    assert resolution.base_url == "http://remote.example/wm-api"
    assert session.calls[0][0] == "http://bad.local:5000/health"
    assert session.calls[1][0] == "http://remote.example/wm-api/health"


def test_format_panel_snapshot_routes_known_panel_ids():
    assert format_panel_snapshot("latest-content", {"items": [{"id": "n1", "title": "Hello", "source": "RSS"}]})[0].topic == "news"
    assert format_panel_snapshot("alpha-signal", {"items": [{"id": "a1", "title": "Signal"}]})[0].topic == "alpha"
    assert format_panel_snapshot("polymarket-macro-map", {"items": [{"id": "m1", "title": "Macro"}]})[0].topic == "macro"
    assert format_panel_snapshot("unknown", {"items": [{"id": "x", "title": "Nope"}]}) == []
