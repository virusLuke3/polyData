import type { PanelModule } from '../types';
import { panel as activeMarkets } from './active-markets';
import { panel as globalOrderfilled } from './global-orderfilled';
import { panel as oracleFeed } from './oracle-feed';
import { panel as marketSummary } from './market-summary';
import { panel as featuredMarket } from './featured-market';
import { panel as priceImplications } from './price-implications';
import { panel as priceChart } from './price-chart';
import { panel as sampleChainTrades } from './sample-chain-trades';
import { panel as oracleTimeline } from './oracle-timeline';
import { panel as relatedNews } from './related-news';
import { panel as alphaSignal } from './alpha-signal';
import { panel as whaleTracker } from './whale-tracker';
import { panel as suspiciousFlow } from './suspicious-flow';
import { panel as commoditiesWatch } from './commodities-watch';
import { panel as cryptoWatch } from './crypto-watch';
import { panel as cryptoFundingWatch } from './crypto-funding-watch';
import { panel as financeMarketAtlas } from './finance-market-atlas';
import { panel as equityEventCommand } from './equity-event-command';
import { panel as onchainTradfiPerpRadar } from './onchain-tradfi-perp-radar';
import { panel as financeLiquidityRegime } from './finance-liquidity-regime';
import { panel as geoSanctionsShock } from './geo-sanctions-shock';
import { panel as cpiReleaseCommandCenter } from './cpi-release-command-center';
import { panel as cpiComponentsPressureRegistry } from './cpi-components-pressure-registry';
import { panel as goodsTariffSupplyWatch } from './goods-tariff-supply-watch';
import { panel as laborServicesInflationMonitor } from './labor-services-inflation-monitor';
import { panel as fedReactionGrowthRiskBoard } from './fed-reaction-growth-risk-board';
import { panel as polymarketMacroMap } from './polymarket-macro-map';
import { panel as cpiReleaseCalendar } from './cpi-release-calendar';
import { panel as energyGasolineShock } from './energy-gasoline-shock';
import { panel as globalTemperatureMonitor } from './global-weather-map';
import { panel as weatherCitySnapshot } from './weather-city-snapshot';
import { panel as weatherQuoteDetail } from './weather-quote-detail';
import { panel as weatherQuoteTable } from './weather-quote-table';
import { panel as weatherTrendDetail } from './weather-trend-detail';
import { panel as weatherTrend7d } from './weather-trend-7d';
import { panel as weatherNews } from './weather-news';
import { panel as foodRetailBasketPressure } from './food-retail-basket-pressure';
import { panel as supplyTariffImportWatch } from './supply-tariff-import-watch';
import { panel as shelterRentOerPressure } from './shelter-rent-oer-pressure';
import { panel as laborWageServicesPressure } from './labor-wage-services-pressure';
import { panel as growthDemandRecessionTracker } from './growth-demand-recession-tracker';
import { panel as fedRatesPolymarketGap } from './fed-rates-polymarket-gap';
import { panel as nbaScoreboard } from './nba-scoreboard';
import { panel as nbaIntel } from './nba-intel';
import { panel as espnMatchupPredictor } from './espn-matchup-predictor';
import { panel as esportsIntel } from './esports-intel';
import { panel as sportsOdds } from './sports-odds';
import { panel as inflationNowcast } from './inflation-nowcast';
import { panel as jin10Flash } from './jin10-flash';
import { panel as newMarketSignals } from './new-market-signals';
import { panel as lobDepth } from './lob-depth';
import { panel as f1Trackside } from './f1-trackside';

export const PANEL_MODULES: PanelModule[] = [
  activeMarkets,
  globalOrderfilled,
  oracleFeed,
  marketSummary,
  featuredMarket,
  priceImplications,
  priceChart,
  sampleChainTrades,
  oracleTimeline,
  relatedNews,
  alphaSignal,
  whaleTracker,
  suspiciousFlow,
  commoditiesWatch,
  cryptoWatch,
  cryptoFundingWatch,
  financeMarketAtlas,
  equityEventCommand,
  onchainTradfiPerpRadar,
  financeLiquidityRegime,
  geoSanctionsShock,
  cpiReleaseCommandCenter,
  cpiComponentsPressureRegistry,
  goodsTariffSupplyWatch,
  laborServicesInflationMonitor,
  fedReactionGrowthRiskBoard,
  polymarketMacroMap,
  cpiReleaseCalendar,
  energyGasolineShock,
  globalTemperatureMonitor,
  weatherCitySnapshot,
  weatherQuoteDetail,
  weatherQuoteTable,
  weatherTrendDetail,
  weatherTrend7d,
  weatherNews,
  foodRetailBasketPressure,
  supplyTariffImportWatch,
  shelterRentOerPressure,
  laborWageServicesPressure,
  growthDemandRecessionTracker,
  inflationNowcast,
  fedRatesPolymarketGap,
  nbaScoreboard,
  nbaIntel,
  espnMatchupPredictor,
  esportsIntel,
  sportsOdds,
  jin10Flash,
  newMarketSignals,
  lobDepth,
  f1Trackside,
];
