from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional


class BotState:
    def __init__(self, path: str) -> None:
        self.path = Path(path).expanduser()
        self.data: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            self.data = {}
            return
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8") or "{}")
        except (OSError, json.JSONDecodeError):
            self.data = {}

    @property
    def offset(self) -> Optional[int]:
        value = self.data.get("offset")
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def mark_update(self, update_id: int) -> None:
        self.data["offset"] = int(update_id) + 1

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=True, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(self.path)
