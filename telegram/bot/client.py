from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import requests

from telegram.topics.client import MAX_SEND_ATTEMPTS, TelegramClient, _retry_after_seconds, _telegram_error_message


class TelegramBotClient(TelegramClient):
    def get_updates(
        self,
        *,
        offset: Optional[int] = None,
        timeout_seconds: int = 25,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        if not self.bot_token:
            raise RuntimeError("POLYDATA_TELEGRAM_BOT_TOKEN is required unless dry-run is enabled")
        payload: Dict[str, Any] = {
            "timeout": max(1, int(timeout_seconds or 25)),
            "limit": min(100, max(1, int(limit or 50))),
            "allowed_updates": ["message"],
        }
        if offset is not None:
            payload["offset"] = int(offset)
        body: Dict[str, Any] = {}
        response: Optional[requests.Response] = None
        for attempt in range(MAX_SEND_ATTEMPTS):
            response = self.session.post(
                f"{self.api_base}/bot{self.bot_token}/getUpdates",
                json=payload,
                timeout=max(self.timeout_seconds, payload["timeout"] + 5),
            )
            try:
                body = response.json()
            except ValueError:
                body = {}
            if response.status_code == 429 and attempt < MAX_SEND_ATTEMPTS - 1:
                time.sleep(_retry_after_seconds(response, body) + 1)
                continue
            break
        if response is None:
            raise RuntimeError("Telegram getUpdates failed before request was sent")
        if response.status_code >= 400:
            raise RuntimeError(_telegram_error_message(response, body))
        if not body.get("ok"):
            raise RuntimeError(f"Telegram getUpdates failed: {body}")
        result = body.get("result")
        return result if isinstance(result, list) else []
