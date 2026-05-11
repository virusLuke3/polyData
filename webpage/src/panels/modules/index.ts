import type { PanelModule } from '../types';
import { panel as worldBrief } from './world-brief';
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
import { panel as relatedVideo } from './related-video';
import { panel as reportFeed } from './report-feed';
import { panel as researchFeed } from './research-feed';
import { panel as alphaSignal } from './alpha-signal';
import { panel as whaleTracker } from './whale-tracker';
import { panel as suspiciousFlow } from './suspicious-flow';
import { panel as commoditiesWatch } from './commodities-watch';
import { panel as cryptoWatch } from './crypto-watch';
import { panel as cryptoFundingWatch } from './crypto-funding-watch';
import { panel as geoSanctionsShock } from './geo-sanctions-shock';
import { panel as nbaScoreboard } from './nba-scoreboard';
import { panel as nbaIntel } from './nba-intel';
import { panel as espnMatchupPredictor } from './espn-matchup-predictor';
import { panel as inflationNowcast } from './inflation-nowcast';
import { panel as jin10Flash } from './jin10-flash';
import { panel as newMarketSignals } from './new-market-signals';
import { panel as lobDepth } from './lob-depth';
import { panel as liveApiStatus } from './live-api-status';
import { panel as systemHealth } from './system-health';
import { panel as f1Trackside } from './f1-trackside';

export const PANEL_MODULES: PanelModule[] = [
  activeMarkets,
  globalOrderfilled,
  oracleFeed,
  marketSummary,
  featuredMarket,
  worldBrief,
  priceImplications,
  priceChart,
  sampleChainTrades,
  oracleTimeline,
  relatedNews,
  relatedVideo,
  reportFeed,
  researchFeed,
  alphaSignal,
  whaleTracker,
  suspiciousFlow,
  commoditiesWatch,
  cryptoWatch,
  cryptoFundingWatch,
  geoSanctionsShock,
  nbaScoreboard,
  nbaIntel,
  espnMatchupPredictor,
  inflationNowcast,
  jin10Flash,
  newMarketSignals,
  lobDepth,
  liveApiStatus,
  systemHealth,
  f1Trackside,
];
