from __future__ import annotations

import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = REPO_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from api.services import f1_runtime_service


class FakeLogger:
    def exception(self, *args, **kwargs) -> None:
        return None


class FakeApp:
    logger = FakeLogger()


class FakeResponse:
    def __init__(self, *, status_code: int = 200, json_payload=None, text: str = "", headers=None):
        self.status_code = status_code
        self._json_payload = json_payload
        self.text = text
        self.headers = headers or {}
        self.content = text.encode("utf-8") if text else b"json"

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def json(self):
        return self._json_payload


class FakeRequests:
    def __init__(self) -> None:
        self.calls = []

    def get(self, url, params=None, timeout=0, headers=None):
        self.calls.append((url, params))
        if "bwe-ws.com" in url:
            return FakeResponse(
                text="""
                <rss><channel>
                  <item>
                    <title>Binance EN: Binance Futures Will Launch USDⓈ-Margined OPGUSDT Perpetual Contract&lt;br/&gt;Binance 合约将上线 OPGUSDT 永续合约&lt;br/&gt;&lt;br/&gt;————————————&lt;br/&gt;2026-04-22 14:00:00&lt;br/&gt;source: https://www.binance.com/en/support/announcement/example</title>
                    <link>https://t.me/BWEnews/99999</link>
                    <pubDate>Wed, 22 Apr 2026 08:00:00 GMT</pubDate>
                  </item>
                </channel></rss>
                """
            )
        return FakeResponse(json_payload=[])


class F1RuntimeServiceTestCase(unittest.TestCase):
    def make_context(self) -> dict:
        return {
            "SPORTS_RUNTIME_TTL_SECONDS": 60,
            "utc_now_iso": lambda: "2026-04-23T00:00:00Z",
            "app": FakeApp(),
            "requests": FakeRequests(),
            "get_snapshot_payload": lambda namespace, cache_key, builder, ttl_seconds: builder(),
        }

    def test_get_f1_panel_snapshot_builds_live_payload_with_news(self):
        payload = f1_runtime_service.get_f1_panel_snapshot(self.make_context(), limit=8)

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["source"], "bwenews-rss")
        self.assertEqual(payload["sourceUrl"], "https://x.com/bwenews")
        self.assertIsNone(payload["focusMeeting"])
        self.assertTrue(any(item.get("kind") == "news" for item in payload["cards"]))
        self.assertEqual(payload["cards"][0]["title"], "Binance EN: Binance Futures Will Launch USDⓈ-Margined OPGUSDT Perpetual Contract")
        self.assertEqual(payload["cards"][0]["url"], "https://t.me/BWEnews/99999")
        self.assertIn("Binance 合约将上线 OPGUSDT 永续合约", payload["cards"][0]["summary"])

    def test_get_f1_panel_snapshot_returns_empty_when_requests_unavailable(self):
        ctx = self.make_context()
        ctx["requests"] = None

        payload = f1_runtime_service.get_f1_panel_snapshot(ctx, limit=8)

        self.assertEqual(payload["status"], "empty")
        self.assertEqual(payload["cards"], [])


if __name__ == "__main__":
    unittest.main()
