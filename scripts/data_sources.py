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
GRID_OPEN_ACCESS_BASE_URL = env_str("POLYDATA_GRID_OPEN_ACCESS_BASE_URL")
GRID_CENTRAL_DATA_GRAPHQL_URL = env_str("POLYDATA_GRID_CENTRAL_DATA_GRAPHQL_URL")
GRID_SERIES_STATE_GRAPHQL_URL = env_str("POLYDATA_GRID_SERIES_STATE_GRAPHQL_URL")
GRID_SOURCE_URL = env_str("POLYDATA_GRID_SOURCE_URL")
THE_ODDS_API_BASE_URL = env_str("POLYDATA_THE_ODDS_API_BASE_URL")
THE_ODDS_SOURCE_URL = env_str("POLYDATA_THE_ODDS_SOURCE_URL")
OPEN_METEO_API_URL = env_str("POLYDATA_OPEN_METEO_API_URL")
AVIATIONWEATHER_METAR_API_URL = env_str("POLYDATA_AVIATIONWEATHER_METAR_API_URL")
GOOGLE_NEWS_RSS_URL = env_str("POLYDATA_GOOGLE_NEWS_RSS_URL")
WEATHER_SOURCE_URL = env_str("POLYDATA_WEATHER_SOURCE_URL")

ESPN_NBA_BASE_URL = env_str("POLYDATA_ESPN_NBA_BASE_URL")
ESPN_CORE_NBA_BASE_URL = env_str("POLYDATA_ESPN_CORE_NBA_BASE_URL")
ESPN_RSS_NEWS_URL = env_str("POLYDATA_RSS_ESPN_NEWS_URL", "https://www.espn.com/espn/rss/news")
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
        "url": env_str("POLYDATA_RSS_BBC_WORLD_URL", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        "category": "World",
    },
    {
        "source": "BBC Politics",
        "url": env_str("POLYDATA_RSS_BBC_POLITICS_URL", "https://feeds.bbci.co.uk/news/politics/rss.xml"),
        "category": "Politics",
    },
    {
        "source": "Guardian World",
        "url": env_str("POLYDATA_RSS_GUARDIAN_WORLD_URL", "https://www.theguardian.com/world/rss"),
        "category": "World",
    },
    {
        "source": "NPR News",
        "url": env_str("POLYDATA_RSS_NPR_NEWS_URL", "https://feeds.npr.org/1001/rss.xml"),
        "category": "US",
    },
    {
        "source": "AP News",
        "url": env_str("POLYDATA_RSS_AP_NEWS_URL", "https://news.google.com/rss/search?q=site:apnews.com+when:3d&hl=en-US&gl=US&ceid=US:en"),
        "category": "World",
    },
    {
        "source": "Reuters World",
        "url": env_str("POLYDATA_RSS_REUTERS_WORLD_URL", "https://news.google.com/rss/search?q=site:reuters.com+world+when:3d&hl=en-US&gl=US&ceid=US:en"),
        "category": "World",
    },
    {
        "source": "Reuters Business",
        "url": env_str("POLYDATA_RSS_REUTERS_BUSINESS_URL", "https://news.google.com/rss/search?q=site:reuters.com+business+markets+when:3d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Finance",
    },
    {
        "source": "Politico",
        "url": env_str("POLYDATA_RSS_POLITICO_URL", "https://rss.politico.com/politics-news.xml"),
        "category": "Politics",
    },
    {
        "source": "The Hill",
        "url": env_str("POLYDATA_RSS_THE_HILL_URL", "https://thehill.com/news/feed/"),
        "category": "Politics",
    },
    {
        "source": "Al Jazeera",
        "url": env_str("POLYDATA_RSS_AL_JAZEERA_URL", "https://www.aljazeera.com/xml/rss/all.xml"),
        "category": "World",
    },
    {
        "source": "CNBC",
        "url": env_str("POLYDATA_RSS_CNBC_URL", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
        "category": "Finance",
    },
    {
        "source": "Yahoo Finance",
        "url": env_str("POLYDATA_RSS_YAHOO_FINANCE_URL", "https://finance.yahoo.com/news/rssindex"),
        "category": "Finance",
    },
    {
        "source": "CoinDesk",
        "url": env_str("POLYDATA_RSS_COINDESK_URL", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
        "category": "Crypto",
    },
    {
        "source": "Cointelegraph",
        "url": env_str("POLYDATA_RSS_COINTELEGRAPH_URL", "https://cointelegraph.com/rss"),
        "category": "Crypto",
    },
    {
        "source": "Decrypt",
        "url": env_str("POLYDATA_RSS_DECRYPT_URL", "https://decrypt.co/feed"),
        "category": "Crypto",
    },
    {
        "source": "Polymarket News",
        "url": env_str("POLYDATA_RSS_POLYMARKET_NEWS_URL", "https://news.google.com/rss/search?q=(Polymarket+OR+%22prediction+market%22+OR+%22prediction+markets%22)+when:7d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Prediction Markets",
    },
    {
        "source": "Election Markets",
        "url": env_str("POLYDATA_RSS_ELECTION_MARKETS_URL", "https://news.google.com/rss/search?q=(election+polls+OR+presidential+election+OR+nominee+OR+campaign)+when:3d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Elections",
    },
    {
        "source": "Geopolitics Markets",
        "url": env_str("POLYDATA_RSS_GEOPOLITICS_MARKETS_URL", "https://news.google.com/rss/search?q=(war+ceasefire+sanctions+Iran+Ukraine+China+Taiwan)+when:2d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Geopolitics",
    },
    {
        "source": "Macro Markets",
        "url": env_str("POLYDATA_RSS_MACRO_MARKETS_URL", "https://news.google.com/rss/search?q=(Fed+inflation+CPI+rates+jobs+oil+markets)+when:2d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Macro",
    },
    {
        "source": "Tech Markets",
        "url": env_str("POLYDATA_RSS_TECH_MARKETS_URL", "https://news.google.com/rss/search?q=(AI+OpenAI+Nvidia+Tesla+Elon+technology)+when:3d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Tech",
    },
    {
        "source": "ESPN",
        "url": ESPN_RSS_NEWS_URL,
        "category": "Sports",
    },
    {
        "source": "Cricket Markets",
        "url": env_str("POLYDATA_RSS_CRICKET_MARKETS_URL", "https://news.google.com/rss/search?q=(%22Indian+Premier+League%22+OR+IPL+OR+cricket+OR+Rajasthan+Royals+OR+Lucknow+Super+Giants)+when:7d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Sports",
    },
    {
        "source": "Esports Markets",
        "url": env_str("POLYDATA_RSS_ESPORTS_MARKETS_URL", "https://news.google.com/rss/search?q=(esports+OR+Valorant+OR+%22Counter-Strike%22+OR+%22League+of+Legends%22+OR+Dota+OR+KR%C3%9C+OR+KRU)+when:7d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Sports",
    },
    {
        "source": "Sports Markets",
        "url": env_str("POLYDATA_RSS_SPORTS_MARKETS_URL", "https://news.google.com/rss/search?q=(NBA+NFL+MLB+NHL+UFC+esports+injury+odds)+when:2d&hl=en-US&gl=US&ceid=US:en"),
        "category": "Sports",
    },
]


def non_empty_feeds(feeds: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return [feed for feed in feeds if str(feed.get("url") or "").strip()]
