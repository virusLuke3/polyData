from __future__ import annotations

import contextlib
import os
from typing import Any, Iterator

import requests
import urllib3

from .env import get_bool_env, get_env, get_float_env


PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


@contextlib.contextmanager
def without_proxy_env() -> Iterator[None]:
    saved = {key: os.environ[key] for key in PROXY_ENV_KEYS if key in os.environ}
    for key in PROXY_ENV_KEYS:
        os.environ.pop(key, None)
    try:
        yield
    finally:
        os.environ.update(saved)


class OpenAICompatibleClient:
    def __init__(self) -> None:
        self.api_key = get_env("API_KEY")
        self.api_base = get_env("POLYDATA_AGENT_API_BASE", "https://gpt-api.hkust-gz.edu.cn/v1/chat/completions")
        self.model = get_env("POLYDATA_AGENT_MODEL", "gpt-5.3-chat")
        self.timeout = get_float_env("POLYDATA_AGENT_TIMEOUT_SECONDS", 45.0)
        self.verify_ssl = get_bool_env("POLYDATA_AGENT_SSL_VERIFY", False)
        if not self.verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_base and self.model)

    def complete_json(self, messages: list[dict[str, str]], *, max_tokens: int = 900) -> str:
        if not self.configured:
            raise RuntimeError("API_KEY or model endpoint is not configured")
        token_key = "max_completion_tokens" if self.model.lower().startswith("gpt-5") else "max_tokens"
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            token_key: max_tokens,
        }
        if "gpt-5.3" not in self.model.lower():
            body["temperature"] = 0.2
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        with without_proxy_env():
            response = requests.post(
                self.api_base,
                headers=headers,
                json=body,
                timeout=self.timeout,
                verify=self.verify_ssl,
            )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise RuntimeError(str(payload.get("error")))
        choices = payload.get("choices") or []
        if not choices:
            raise RuntimeError("LLM response had no choices")
        message = choices[0].get("message") or {}
        content = message.get("content") or ""
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("LLM response content was empty")
        return content
