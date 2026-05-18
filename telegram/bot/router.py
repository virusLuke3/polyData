from __future__ import annotations

import re
from typing import Any, Dict, Optional

from .models import CommandRequest


COMMAND_RE = re.compile(r"^/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$", re.DOTALL)


def parse_update(update: Dict[str, Any]) -> Optional[CommandRequest]:
    message = update.get("message") if isinstance(update.get("message"), dict) else None
    if not message:
        return None
    text = str(message.get("text") or "").strip()
    if not text:
        return None
    match = COMMAND_RE.match(text)
    if not match:
        return CommandRequest(
            update_id=int(update.get("update_id") or 0),
            chat_id=(message.get("chat") or {}).get("id", ""),
            user_id=(message.get("from") or {}).get("id"),
            message_id=message.get("message_id"),
            text=text,
            command="help",
            args="",
            raw=update,
        )
    return CommandRequest(
        update_id=int(update.get("update_id") or 0),
        chat_id=(message.get("chat") or {}).get("id", ""),
        user_id=(message.get("from") or {}).get("id"),
        message_id=message.get("message_id"),
        text=text,
        command=match.group(1).lower(),
        args=str(match.group(2) or "").strip(),
        raw=update,
    )
