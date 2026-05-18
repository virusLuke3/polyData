from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class CommandRequest:
    update_id: int
    chat_id: int | str
    user_id: Optional[int]
    message_id: Optional[int]
    text: str
    command: str
    args: str
    raw: Dict[str, Any]


@dataclass(frozen=True)
class BotReply:
    text: str
    link_preview: bool = False
