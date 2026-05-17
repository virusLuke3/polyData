from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests


MAX_TELEGRAM_TEXT_LENGTH = 4096
SAFE_TEXT_LENGTH = 3900


def split_message(text: str, *, limit: int = SAFE_TEXT_LENGTH) -> List[str]:
    clean = str(text or "").strip()
    if len(clean) <= limit:
        return [clean] if clean else []
    chunks: List[str] = []
    remaining = clean
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break
        cut = remaining.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = remaining.rfind(" ", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    return [chunk for chunk in chunks if chunk]


class TelegramClient:
    def __init__(self, *, bot_token: str, api_base: str = "https://api.telegram.org", timeout_seconds: int = 12) -> None:
        self.bot_token = str(bot_token or "").strip()
        self.api_base = str(api_base or "https://api.telegram.org").rstrip("/")
        self.timeout_seconds = max(1, int(timeout_seconds or 12))
        self.session = requests.Session()

    def send_message(
        self,
        *,
        chat_id: str,
        text: str,
        message_thread_id: Optional[int] = None,
        disable_web_page_preview: bool = True,
        disable_notification: bool = False,
    ) -> List[Dict[str, Any]]:
        if not self.bot_token:
            raise RuntimeError("POLYDATA_TELEGRAM_BOT_TOKEN is required unless dry-run is enabled")
        results: List[Dict[str, Any]] = []
        for chunk in split_message(text):
            payload: Dict[str, Any] = {
                "chat_id": chat_id,
                "text": chunk[:MAX_TELEGRAM_TEXT_LENGTH],
                "disable_web_page_preview": disable_web_page_preview,
                "disable_notification": disable_notification,
            }
            if message_thread_id is not None:
                payload["message_thread_id"] = message_thread_id
            response = self.session.post(
                f"{self.api_base}/bot{self.bot_token}/sendMessage",
                json=payload,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            if not body.get("ok"):
                raise RuntimeError(f"Telegram sendMessage failed: {body}")
            results.append(body)
        return results

