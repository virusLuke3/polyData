#!/usr/bin/env python3
"""Validate local-vs-remote polyData environment files without printing secrets."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


SECRET_MARKERS = ("PASSWORD", "SECRET", "TOKEN", "KEY", "NODE_URL", "RPC")

REMOTE_REQUIRED = {
    "POLYMARKET_DB_BACKEND": "mysql",
    "POLYMARKET_MYSQL_HOST": "127.0.0.1",
    "POLYMARKET_MYSQL_PORT": "43306",
    "POLYMARKET_MYSQL_USER": "poly_readonly",
    "POLYMARKET_MYSQL_DATABASE": "poly_data",
    "POLYMARKET_MYSQL_CHARSET": "utf8mb4",
    "POLYMARKET_MYSQL_CONNECT_TIMEOUT": "10",
    "POLYMARKET_MYSQL_READ_TIMEOUT": "60",
    "POLYMARKET_MYSQL_WRITE_TIMEOUT": "60",
    "POLYDATA_API_READONLY": "1",
    "POLYDATA_API_HOST": "127.0.0.1",
    "POLYDATA_API_PORT": "18500",
    "POLYDATA_REDIS_URL": "redis://127.0.0.1:6379/0",
    "POLYDATA_REDIS_PREFIX": "polydata:",
    "POLYDATA_SNAPSHOT_SQLITE_PATH": "/opt/polyData/data/panel_snapshots.sqlite3",
    "POLYDATA_GUNICORN_WORKERS": "3",
    "POLYDATA_GUNICORN_THREADS": "4",
    "POLYDATA_GUNICORN_MAX_REQUESTS": "300",
    "POLYDATA_GUNICORN_MAX_REQUESTS_JITTER": "60",
    "POLYDATA_MARKETS_RUNTIME_PRICES": "0",
    "POLYDATA_MARKETS_LATEST_SNAPSHOT_FALLBACK": "1",
}

LOCAL_REQUIRED = {
    "POLYMARKET_DB_BACKEND": "mysql",
    "POLYMARKET_MYSQL_HOST": "127.0.0.1",
    "POLYMARKET_MYSQL_DATABASE": "poly_data",
}

REMOTE_UNNEEDED_PREFIXES = ("VITE_",)
REMOTE_UNNEEDED_KEYS = {
    "POLYDATA_PUBLIC_WEB_URL",
    "POLYMARKET_RPC_URL",
    "NODE_URL",
}


def parse_env(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def masked(key: str, value: str | None) -> str:
    if value is None:
        return "<missing>"
    if any(marker in key.upper() for marker in SECRET_MARKERS):
        return "<set>" if value else "<empty>"
    return value


def check_required(values: Dict[str, str], required: Dict[str, str]) -> List[Tuple[str, str]]:
    issues: List[Tuple[str, str]] = []
    for key, expected in required.items():
        actual = values.get(key)
        if actual != expected:
            issues.append((key, f"expected {masked(key, expected)}, got {masked(key, actual)}"))
    return issues


def check_remote(values: Dict[str, str]) -> tuple[List[str], List[str]]:
    errors = [f"{key}: {detail}" for key, detail in check_required(values, REMOTE_REQUIRED)]
    warnings: List[str] = []
    for key in sorted(values):
        if key in REMOTE_UNNEEDED_KEYS or any(key.startswith(prefix) for prefix in REMOTE_UNNEEDED_PREFIXES):
            warnings.append(f"{key}: remote readonly API does not need this local/sync/frontend variable")
    if values.get("POLYMARKET_MYSQL_USER") and values.get("POLYMARKET_MYSQL_USER") != "poly_readonly":
        errors.append("POLYMARKET_MYSQL_USER: remote API must use poly_readonly")
    return errors, warnings


def check_local(values: Dict[str, str]) -> tuple[List[str], List[str]]:
    errors = [f"{key}: {detail}" for key, detail in check_required(values, LOCAL_REQUIRED)]
    warnings: List[str] = []
    if values.get("POLYDATA_API_READONLY") == "1":
        warnings.append("POLYDATA_API_READONLY=1: local env is usually for sync/write/development, not readonly API")
    if values.get("POLYMARKET_MYSQL_USER") == "poly_readonly":
        warnings.append("POLYMARKET_MYSQL_USER=poly_readonly: local sync jobs need a write-capable DB user")
    for key in ("POLYDATA_GUNICORN_WORKERS", "POLYDATA_GUNICORN_THREADS", "POLYDATA_GUNICORN_MAX_REQUESTS"):
        if key in values:
            warnings.append(f"{key}: local .env usually does not need remote Gunicorn service tuning")
    return errors, warnings


def print_section(title: str, lines: Iterable[str]) -> None:
    print(title)
    materialized = list(lines)
    if not materialized:
        print("  none")
        return
    for line in materialized:
        print(f"  - {line}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether a polyData env file matches its local or remote role.")
    parser.add_argument("--role", choices=("local", "remote"), required=True)
    parser.add_argument("--env", required=True, type=Path)
    args = parser.parse_args()

    values = parse_env(args.env)
    errors, warnings = check_local(values) if args.role == "local" else check_remote(values)

    print(f"env={args.env}")
    print(f"role={args.role}")
    print(f"keys={len(values)}")
    print_section("errors", errors)
    print_section("warnings", warnings)
    print("verdict=PASS" if not errors else "verdict=FAIL")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
