#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone watcher for geo / sanctions shock panel snapshots.

The watcher fetches external sources on a timer, computes the render-ready panel
payload, and stores it in Redis plus the local SQLite snapshot store. The API
path then reads the seeded snapshot instead of fetching upstreams inline.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

_scripts_root = Path(__file__).resolve().parents[1]
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    import redis
except ImportError:
    redis = None

try:
    import requests
except ImportError:
    requests = None

from api.config import load_api_settings
from api.services import geo_sanctions_shock_service
from runtime.snapshot_store import SnapshotStore


DEFAULT_INTERVAL_SECONDS = 300


class _LoggerAdapter:
    def info(self, message: str, *args: Any, **kwargs: Any) -> None:
        print(f"[geo-shock] INFO {message % args if args else message}", file=sys.stderr)

    def warning(self, message: str, *args: Any, **kwargs: Any) -> None:
        print(f"[geo-shock] WARN {message % args if args else message}", file=sys.stderr)

    def exception(self, message: str, *args: Any, **kwargs: Any) -> None:
        print(f"[geo-shock] ERROR {message % args if args else message}", file=sys.stderr)


class _AppAdapter:
    logger = _LoggerAdapter()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _redis_key(prefix: str, namespace: str, cache_key: str) -> str:
    return f"{str(prefix or '')}{namespace}:{cache_key}"


def _cache_ttl_seconds(settings: Any) -> int:
    return max(300, int(settings.geo_shock_ttl_seconds or 900))


class GeoSanctionsShockWatcher:
    def __init__(
        self,
        *,
        redis_url: str,
        redis_prefix: str,
        snapshot_sqlite_path: str,
        settings: Any,
    ) -> None:
        if redis is None:
            raise RuntimeError("redis package is required. Install scripts/requirements.txt")
        if requests is None:
            raise RuntimeError("requests package is required. Install scripts/requirements.txt")
        if not str(redis_url or "").strip():
            raise RuntimeError("POLYDATA_REDIS_URL is required for geo shock watcher")
        self.settings = settings
        self.redis_prefix = str(redis_prefix or "")
        self.redis_client = redis.from_url(redis_url, decode_responses=True)
        self.snapshot_store = SnapshotStore(snapshot_sqlite_path)
        self.requests = requests.Session()
        self.requests.headers.update({"User-Agent": "polyData-geo-shock-watcher/1.0"})

    def cache_key(self) -> str:
        return geo_sanctions_shock_service.GEO_SHOCK_CACHE_KEY

    def namespace(self) -> str:
        return geo_sanctions_shock_service.GEO_SHOCK_SNAPSHOT_NAMESPACE

    def redis_key(self) -> str:
        return _redis_key(self.redis_prefix, self.namespace(), self.cache_key())

    def _http_json_get(self, url: str, params: Optional[Dict[str, Any]] = None, timeout: int = 15, headers: Optional[Dict[str, str]] = None) -> Any:
        response = self.requests.get(url, params=params, timeout=timeout, headers=headers)
        response.raise_for_status()
        if not response.content:
            return {}
        return response.json()

    def load_previous_payload(self) -> Dict[str, Any]:
        try:
            raw = self.redis_client.get(self.redis_key())
            if raw:
                payload = json.loads(raw)
                if isinstance(payload, dict):
                    return payload
        except Exception:
            _AppAdapter.logger.exception("geo shock watcher redis read failed")
        stale = self.snapshot_store.get_stale(self.namespace(), self.cache_key())
        return stale if isinstance(stale, dict) else {}

    def build_payload(self) -> Dict[str, Any]:
        previous = self.load_previous_payload()
        ctx = {
            "SETTINGS": self.settings,
            "app": _AppAdapter(),
            "requests": self.requests,
            "http_json_get": self._http_json_get,
            "utc_now_iso": utc_now_iso,
        }
        return geo_sanctions_shock_service.build_geo_sanctions_shock_seed_payload(ctx, previous=previous)

    def store_payload(self, payload: Dict[str, Any]) -> None:
        ttl_seconds = _cache_ttl_seconds(self.settings)
        self.snapshot_store.set(self.namespace(), self.cache_key(), payload, ttl_seconds)
        self.redis_client.set(self.redis_key(), json.dumps(payload, ensure_ascii=True, default=str), ex=ttl_seconds)

    def run_once(self) -> Dict[str, Any]:
        previous = self.load_previous_payload()
        payload = self.build_payload()
        if (
            previous
            and not geo_sanctions_shock_service.payload_has_material_signal(payload)
            and not geo_sanctions_shock_service.payload_has_source_success(payload)
        ):
            _AppAdapter.logger.warning("geo shock watcher preserved previous snapshot because new payload had no material signal")
            self.store_payload(previous)
            return {"status": "preserved", "payload": previous}
        self.store_payload(payload)
        return {"status": "stored", "payload": payload}


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed geo / sanctions shock panel snapshots into Redis and SQLite")
    parser.add_argument("--watch", action="store_true", help="Run continuously instead of once")
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.environ.get("POLYDATA_GEO_SHOCK_WATCH_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS)),
        help="Seconds between refresh runs in watch mode",
    )
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()
    settings = load_api_settings()
    watcher = GeoSanctionsShockWatcher(
        redis_url=settings.redis_url,
        redis_prefix=settings.redis_prefix,
        snapshot_sqlite_path=settings.snapshot_sqlite_path,
        settings=settings,
    )
    watcher.redis_client.ping()
    print(
        f"[geo-shock] redis_key={watcher.redis_key()} sqlite={settings.snapshot_sqlite_path}",
        file=sys.stderr,
    )
    if not args.watch:
        result = watcher.run_once()
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        return 0

    interval_seconds = max(30, int(args.interval or DEFAULT_INTERVAL_SECONDS))
    while True:
        try:
            result = watcher.run_once()
            print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        except KeyboardInterrupt:
            return 0
        except Exception as exc:
            print(f"[geo-shock] ERROR watch loop failed: {exc}", file=sys.stderr)
        time.sleep(interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
