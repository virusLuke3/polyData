from __future__ import annotations

from typing import Any, Dict, Optional


def http_json_get(
    ctx: dict,
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 12,
    headers: Optional[Dict[str, str]] = None,
) -> Any:
    requests_lib = ctx.get("requests")
    if requests_lib is None:
        return None
    response = requests_lib.get(url, params=params, timeout=timeout, headers=headers or {"Accept": "application/json"})
    response.raise_for_status()
    if not response.content:
        return None
    return response.json()

