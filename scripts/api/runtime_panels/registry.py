from __future__ import annotations

from types import ModuleType
from typing import Dict, Iterable, List, Optional

from .modules import (
    alpha_signal,
    crypto_funding_watch,
    commodities_watch,
    cpi_components_pressure_registry,
    cpi_release_command_center,
    cpi_release_calendar,
    crypto_watch,
    energy_gasoline_shock,
    espn_matchup_predictor,
    f1_trackside,
    fed_reaction_growth_risk_board,
    fed_rates_polymarket_gap,
    food_retail_basket,
    global_weather_map,
    geo_sanctions_shock,
    goods_tariff_supply_watch,
    growth_demand_recession_tracker,
    inflation_nowcast,
    jin10_flash,
    labor_wage_services_pressure,
    labor_services_inflation_monitor,
    new_market_signals,
    nba_intel,
    nba_scoreboard,
    polymarket_macro_map,
    shelter_rent_oer_pressure,
    supply_tariff_import_watch,
    suspicious_flow,
    weather_news,
    whale_tracker,
)
from .types import RuntimePanelModule


_MODULES: List[ModuleType] = [
    commodities_watch,
    crypto_watch,
    crypto_funding_watch,
    global_weather_map,
    weather_news,
    f1_trackside,
    jin10_flash,
    new_market_signals,
    nba_scoreboard,
    nba_intel,
    espn_matchup_predictor,
    geo_sanctions_shock,
    cpi_release_command_center,
    cpi_components_pressure_registry,
    goods_tariff_supply_watch,
    labor_services_inflation_monitor,
    fed_reaction_growth_risk_board,
    cpi_release_calendar,
    polymarket_macro_map,
    inflation_nowcast,
    energy_gasoline_shock,
    food_retail_basket,
    supply_tariff_import_watch,
    shelter_rent_oer_pressure,
    labor_wage_services_pressure,
    growth_demand_recession_tracker,
    fed_rates_polymarket_gap,
    alpha_signal,
    whale_tracker,
    suspicious_flow,
]


def _coerce_module(module: ModuleType) -> RuntimePanelModule:
    return RuntimePanelModule(
        panel_id=module.PANEL_ID,
        route=module.ROUTE,
        default_limit=module.DEFAULT_LIMIT,
        min_limit=module.MIN_LIMIT,
        max_limit=module.MAX_LIMIT,
        get_snapshot=module.get_snapshot,
    )


RUNTIME_PANEL_MODULES: List[RuntimePanelModule] = [_coerce_module(module) for module in _MODULES]

DEFAULT_WORKSPACE_PANEL_IDS: List[str] = [
    "active-markets",
    "global-orderfilled",
    "oracle-feed",
    "market-summary",
    "featured-market",
    "world-brief",
    "geo-sanctions-shock",
    "cpi-release-command-center",
    "cpi-components-pressure-registry",
    "goods-tariff-supply-watch",
    "labor-services-inflation-monitor",
    "fed-reaction-growth-risk-board",
    "price-implications",
    "price-chart",
    "sample-chain-trades",
    "oracle-timeline",
    "related-news",
    "related-video",
    "report-feed",
    "research-feed",
    "alpha-signal",
    "whale-tracker",
    "suspicious-flow",
    "commodities-watch",
    "crypto-watch",
    "crypto-funding-watch",
    "nba-scoreboard",
    "nba-intel",
    "espn-matchup-predictor",
    "jin10-flash",
    "new-market-signals",
    "lob-depth",
    "live-api-status",
    "system-health",
    "f1-trackside",
]


def _assert_unique(panels: Iterable[RuntimePanelModule]) -> None:
    panel_ids = set()
    routes = set()
    for panel in panels:
        if panel.panel_id in panel_ids:
            raise ValueError(f"duplicate runtime panel id: {panel.panel_id}")
        if panel.route in routes:
            raise ValueError(f"duplicate runtime panel route: {panel.route}")
        panel_ids.add(panel.panel_id)
        routes.add(panel.route)


_assert_unique(RUNTIME_PANEL_MODULES)

_PANELS_BY_ROUTE: Dict[str, RuntimePanelModule] = {panel.route: panel for panel in RUNTIME_PANEL_MODULES}


def get_panel_by_route(route: str) -> Optional[RuntimePanelModule]:
    return _PANELS_BY_ROUTE.get(route)


def get_panel_routes() -> List[str]:
    return [panel.route for panel in RUNTIME_PANEL_MODULES]


def get_panel_ids() -> List[str]:
    return [panel.panel_id for panel in RUNTIME_PANEL_MODULES]


def get_default_panel_ids() -> List[str]:
    return list(DEFAULT_WORKSPACE_PANEL_IDS)
