from __future__ import annotations

import os
from typing import Any, Dict, Optional


def _truthy_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


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
    request_headers = headers or {"Accept": "application/json"}
    trust_env_proxy = _truthy_env("POLYDATA_API_HTTP_TRUST_ENV_PROXY", default=False)
    if hasattr(requests_lib, "Session"):
        session = requests_lib.Session()
        session.trust_env = trust_env_proxy
        try:
            response = session.get(url, params=params, timeout=timeout, headers=request_headers)
            response.raise_for_status()
            if not response.content:
                return None
            return response.json()
        finally:
            try:
                session.close()
            except Exception:
                pass
    response = requests_lib.get(url, params=params, timeout=timeout, headers=request_headers)
    response.raise_for_status()
    if not response.content:
        return None
    return response.json()
