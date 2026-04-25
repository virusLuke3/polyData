from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict


SnapshotGetter = Callable[[Dict[str, Any]], Dict[str, Any]]


@dataclass(frozen=True)
class RuntimePanelModule:
    panel_id: str
    route: str
    default_limit: int | None
    min_limit: int | None
    max_limit: int | None
    get_snapshot: Callable[..., Dict[str, Any]]
    default_enabled: bool = True

    def clamp_limit(self, raw_value: Any = None) -> int | None:
        if self.default_limit is None:
            return None
        try:
            value = int(raw_value if raw_value is not None else self.default_limit)
        except (TypeError, ValueError):
            value = self.default_limit
        if self.min_limit is not None:
            value = max(self.min_limit, value)
        if self.max_limit is not None:
            value = min(self.max_limit, value)
        return value
