#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Centralized configuration for the polyData API service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from db import DEFAULT_DB_PATH


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = Path(__file__).resolve().parents[1]


def _load_dotenv_files() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for candidate in (
        PROJECT_ROOT / ".env",
        PROJECT_ROOT / ".env.local",
        SCRIPTS_ROOT / ".env",
    ):
        if candidate.exists():
            load_dotenv(candidate, override=False)


def _get_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    text = value.strip()
    return text or default


def _get_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def _get_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _get_csv(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if raw is None:
        return default
    values = tuple(part.strip() for part in str(raw).split(",") if part.strip())
    return values or default


@dataclass(frozen=True)
class ApiSettings:
    host: str
    port: int
    allowed_origins: tuple[str, ...]
    db_path: str
    dashboard_cache_ttl_seconds: int
    markets_cache_ttl_seconds: int
    bootstrap_cache_ttl_seconds: int
    bootstrap_component_ttl_seconds: int
    recent_trade_window: int
    address_cache_ttl_seconds: int
    redis_url: str
    redis_prefix: str
    snapshot_sqlite_path: str
    snapshot_prewarm_enabled: bool
    clob_api_base: str
    clob_timeout_seconds: int
    clob_price_cache_ttl_seconds: int
    finance_runtime_ttl_seconds: int
    sports_runtime_ttl_seconds: int
    signal_runtime_ttl_seconds: int
    yahoo_chart_base_url: str
    coingecko_base_url: str
    espn_nba_base_url: str
    nba_lineups_base_url: str
    cleveland_fed_nowcast_url: str
    f1_panel_path: str
    jin10_flash_api_url: str
    jin10_flash_channel: str
    jin10_flash_app_id: str
    jin10_flash_version: str


@lru_cache(maxsize=1)
def load_api_settings() -> ApiSettings:
    _load_dotenv_files()
    snapshot_default = str((PROJECT_ROOT / "data" / "panel_snapshots.sqlite3").resolve())
    return ApiSettings(
        host=_get_str("POLYDATA_API_HOST", "127.0.0.1"),
        port=_get_int("POLYDATA_API_PORT", 18500),
        allowed_origins=_get_csv("POLYDATA_ALLOWED_ORIGINS", ()),
        db_path=_get_str("POLYMARKET_DB", DEFAULT_DB_PATH),
        dashboard_cache_ttl_seconds=_get_int("POLYDATA_DASHBOARD_CACHE_TTL_SECONDS", 300),
        markets_cache_ttl_seconds=_get_int("POLYDATA_MARKETS_CACHE_TTL_SECONDS", 60),
        bootstrap_cache_ttl_seconds=_get_int("POLYDATA_BOOTSTRAP_CACHE_TTL_SECONDS", 30),
        bootstrap_component_ttl_seconds=_get_int("POLYDATA_BOOTSTRAP_COMPONENT_TTL_SECONDS", 60),
        recent_trade_window=_get_int("POLYDATA_DASHBOARD_TRADE_WINDOW", 250000),
        address_cache_ttl_seconds=_get_int("POLYDATA_ADDRESS_CACHE_TTL_SECONDS", 120),
        redis_url=_get_str("POLYDATA_REDIS_URL", ""),
        redis_prefix=_get_str("POLYDATA_REDIS_PREFIX", "polydata:"),
        snapshot_sqlite_path=_get_str("POLYDATA_SNAPSHOT_SQLITE_PATH", snapshot_default),
        snapshot_prewarm_enabled=_get_bool("POLYDATA_SNAPSHOT_PREWARM", True),
        clob_api_base=_get_str("POLYDATA_CLOB_API_BASE", "https://clob.polymarket.com"),
        clob_timeout_seconds=_get_int("POLYDATA_CLOB_TIMEOUT_SECONDS", 12),
        clob_price_cache_ttl_seconds=_get_int("POLYDATA_CLOB_PRICE_CACHE_TTL_SECONDS", 45),
        finance_runtime_ttl_seconds=_get_int("POLYDATA_FINANCE_RUNTIME_TTL_SECONDS", 300),
        sports_runtime_ttl_seconds=_get_int("POLYDATA_SPORTS_RUNTIME_TTL_SECONDS", 60),
        signal_runtime_ttl_seconds=_get_int("POLYDATA_SIGNAL_RUNTIME_TTL_SECONDS", 45),
        yahoo_chart_base_url=_get_str("POLYDATA_YAHOO_CHART_BASE_URL", "https://query1.finance.yahoo.com/v8/finance/chart"),
        coingecko_base_url=_get_str("POLYDATA_COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3"),
        espn_nba_base_url=_get_str("POLYDATA_ESPN_NBA_BASE_URL", "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"),
        nba_lineups_base_url=_get_str("POLYDATA_NBA_LINEUPS_BASE_URL", "https://stats.nba.com/js/data/leaders"),
        cleveland_fed_nowcast_url=_get_str(
            "POLYDATA_CLEVELAND_FED_NOWCAST_URL",
            "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting",
        ),
        f1_panel_path=_get_str(
            "POLYDATA_F1_PANEL_PATH",
            str((PROJECT_ROOT / "data" / "runtime" / "f1" / "panel.json").resolve()),
        ),
        jin10_flash_api_url=_get_str("POLYDATA_JIN10_FLASH_API_URL", "https://flash-api.jin10.com/get_flash_list"),
        jin10_flash_channel=_get_str("POLYDATA_JIN10_FLASH_CHANNEL", "-8200"),
        jin10_flash_app_id=_get_str("POLYDATA_JIN10_APP_ID", "SO1EJGmNgCtmpcPF"),
        jin10_flash_version=_get_str("POLYDATA_JIN10_VERSION", "1.0.0"),
    )
