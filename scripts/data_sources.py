#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Environment-backed external data source configuration.

All upstream website/API URLs used by polyData should be read through this
module or through scripts.api.config, not hard-coded in feature code.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = Path(__file__).resolve().parent


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


def env_str(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    text = str(value).strip().strip('"').strip("'")
    return text or default


_load_dotenv_files()

POLYGON_RPC_URL = env_str("POLYMARKET_RPC_URL") or env_str("NODE_URL")
POLYMARKET_GAMMA_API_BASE = env_str("POLYDATA_GAMMA_API_BASE")
POLYMARKET_MACRO_MAP_SOURCE_URL = env_str("POLYDATA_MACRO_MARKET_MAP_SOURCE_URL")
POLYMARKET_DATA_API_BASE = env_str("POLYDATA_POLYMARKET_DATA_API_BASE")
POLYMARKET_ACTIVITY_API_URL = env_str("POLYDATA_POLYMARKET_ACTIVITY_API_URL")
POLYMARKET_CLOB_API_BASE = env_str("POLYDATA_CLOB_API_BASE")
POLYMARKET_CLOB_WS_URL = env_str("POLYDATA_CLOB_WS_URL")

YAHOO_CHART_BASE_URL = env_str("POLYDATA_YAHOO_CHART_BASE_URL")
COINGECKO_BASE_URL = env_str("POLYDATA_COINGECKO_BASE_URL")
CLEVELAND_FED_NOWCAST_URL = env_str("POLYDATA_CLEVELAND_FED_NOWCAST_URL")
CPI_CALENDAR_BLS_CPI_URL = env_str("POLYDATA_CPI_CALENDAR_BLS_CPI_URL")
CPI_CALENDAR_BLS_EMPLOYMENT_URL = env_str("POLYDATA_CPI_CALENDAR_BLS_EMPLOYMENT_URL")
CPI_CALENDAR_BEA_SCHEDULE_URL = env_str("POLYDATA_CPI_CALENDAR_BEA_SCHEDULE_URL")
CPI_CALENDAR_FOMC_URL = env_str("POLYDATA_CPI_CALENDAR_FOMC_URL")
CPI_CALENDAR_SOURCE_URL = env_str("POLYDATA_CPI_CALENDAR_SOURCE_URL")
ENERGY_SHOCK_WTI_XLS_URL = env_str("POLYDATA_ENERGY_SHOCK_WTI_XLS_URL")
ENERGY_SHOCK_GASOLINE_XLS_URL = env_str("POLYDATA_ENERGY_SHOCK_GASOLINE_XLS_URL")
ENERGY_SHOCK_DIESEL_XLS_URL = env_str("POLYDATA_ENERGY_SHOCK_DIESEL_XLS_URL")
ENERGY_SHOCK_SOURCE_URL = env_str("POLYDATA_ENERGY_SHOCK_SOURCE_URL")
FOOD_BASKET_FRED_CSV_URL_TEMPLATE = env_str("POLYDATA_FOOD_BASKET_FRED_CSV_URL_TEMPLATE")
FOOD_BASKET_SOURCE_URL = env_str("POLYDATA_FOOD_BASKET_SOURCE_URL")
GEO_SHOCK_OFAC_SDN_URL = env_str("POLYDATA_GEO_SHOCK_OFAC_SDN_URL")
GEO_SHOCK_OFAC_CONSOLIDATED_URL = env_str("POLYDATA_GEO_SHOCK_OFAC_CONSOLIDATED_URL")
GEO_SHOCK_FEDERAL_REGISTER_API_URL = env_str("POLYDATA_GEO_SHOCK_FEDERAL_REGISTER_API_URL")
GEO_SHOCK_CONFLICT_API_URL = env_str("POLYDATA_GEO_SHOCK_CONFLICT_API_URL")
GEO_SHOCK_GDELT_DOC_API_URL = env_str("POLYDATA_GEO_SHOCK_GDELT_DOC_API_URL")
GEO_SHOCK_UCDP_API_URL = env_str("POLYDATA_GEO_SHOCK_UCDP_API_URL")
GEO_SHOCK_UCDP_ACCESS_TOKEN = env_str("POLYDATA_GEO_SHOCK_UCDP_ACCESS_TOKEN")
GEO_SHOCK_ACLED_TOKEN_URL = env_str("POLYDATA_GEO_SHOCK_ACLED_TOKEN_URL")
GEO_SHOCK_ACLED_API_URL = env_str("POLYDATA_GEO_SHOCK_ACLED_API_URL")
GEO_SHOCK_ACLED_EMAIL = env_str("POLYDATA_GEO_SHOCK_ACLED_EMAIL") or env_str("ACLED_USERNAME")
GEO_SHOCK_ACLED_PASSWORD = env_str("POLYDATA_GEO_SHOCK_ACLED_PASSWORD") or env_str("ACLED_PASSWORD")
GEO_SHOCK_SOURCE_URL = env_str("POLYDATA_GEO_SHOCK_SOURCE_URL")
CRYPTO_FUNDING_WATCH_API_URL = env_str("POLYDATA_CRYPTO_FUNDING_WATCH_API_URL")
CRYPTO_FUNDING_WATCH_BYBIT_API_URL = env_str("POLYDATA_CRYPTO_FUNDING_WATCH_BYBIT_API_URL")
CRYPTO_FUNDING_WATCH_SOURCE_URL = env_str("POLYDATA_CRYPTO_FUNDING_WATCH_SOURCE_URL")
OPEN_METEO_API_URL = env_str("POLYDATA_OPEN_METEO_API_URL")
AVIATIONWEATHER_METAR_API_URL = env_str("POLYDATA_AVIATIONWEATHER_METAR_API_URL")
GOOGLE_NEWS_RSS_URL = env_str("POLYDATA_GOOGLE_NEWS_RSS_URL")
WEATHER_SOURCE_URL = env_str("POLYDATA_WEATHER_SOURCE_URL")

ESPN_NBA_BASE_URL = env_str("POLYDATA_ESPN_NBA_BASE_URL")
ESPN_CORE_NBA_BASE_URL = env_str("POLYDATA_ESPN_CORE_NBA_BASE_URL")
ESPN_RSS_NEWS_URL = env_str("POLYDATA_RSS_ESPN_NEWS_URL")
NBA_LINEUPS_BASE_URL = env_str("POLYDATA_NBA_LINEUPS_BASE_URL")
NBA_OFFICIAL_BASE_URL = env_str("POLYDATA_NBA_OFFICIAL_BASE_URL")

JIN10_FLASH_API_URL = env_str("POLYDATA_JIN10_FLASH_API_URL")
JIN10_FLASH_DETAIL_BASE_URL = env_str("POLYDATA_JIN10_FLASH_DETAIL_BASE_URL")
JIN10_LIVE_URL = env_str("POLYDATA_JIN10_LIVE_URL")

F1_BWENEWS_RSS_URL = env_str("POLYDATA_F1_BWENEWS_RSS_URL")
F1_BWENEWS_SOURCE_URL = env_str("POLYDATA_F1_BWENEWS_SOURCE_URL")

RSS_FEEDS: List[Dict[str, str]] = [
    {
        "source": "BBC World",
        "url": env_str("POLYDATA_RSS_BBC_WORLD_URL"),
        "category": "World",
    },
    {
        "source": "BBC Politics",
        "url": env_str("POLYDATA_RSS_BBC_POLITICS_URL"),
        "category": "Politics",
    },
    {
        "source": "CoinDesk",
        "url": env_str("POLYDATA_RSS_COINDESK_URL"),
        "category": "Crypto",
    },
    {
        "source": "ESPN",
        "url": ESPN_RSS_NEWS_URL,
        "category": "Sports",
    },
]


def non_empty_feeds(feeds: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return [feed for feed in feeds if str(feed.get("url") or "").strip()]
