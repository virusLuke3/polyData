export type MarketSummary = {
  id: number;
  slug: string;
  title: string;
  conditionId?: string | null;
  questionId?: string | null;
  oracle?: string | null;
  yesTokenId?: string | null;
  noTokenId?: string | null;
  description?: string;
  status?: string;
  latestPrice?: string | number | null;
  latestYesPrice?: string | number | null;
  latestNoPrice?: string | number | null;
  enableNegRisk?: boolean;
  endDate?: string | null;
  createdAt?: string | null;
  category?: string;
  tags?: string[];
  gammaMarketId?: string | number | null;
};

export type BootstrapPayload = {
  generatedAt: string;
  defaultWorkspace: {
    name: string;
    panels: string[];
  };
  featuredMarket: MarketSummary | null;
  activeMarketsPreview: MarketListItem[];
  globalTradesPreview: TradeRow[];
  globalOraclePreview: OracleEvent[];
  latestContentPreview: ContentItem[];
  commoditiesPreview?: RuntimeMarketGroup | null;
  recentTradesPreview: TradeRow[];
  oraclePreview: OracleEvent[];
  contentPreview: ContentItem[];
  pricePreview: PriceSummary | null;
  systemHealth: SystemHealth;
};

export type MarketsPayload = {
  items: MarketListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
};

export type MarketListItem = {
  id: number;
  slug: string;
  title: string;
  conditionId?: string | null;
  questionId?: string | null;
  endDate?: string | null;
  createdAt?: string | null;
  latestPrice?: string | number | null;
  status?: string;
  category?: string;
  tags?: string[];
  outcomeCount?: number | null;
  volume24h?: string | number | null;
  tradeCount24h?: number | null;
  change24h?: string | number | null;
  lastTradeAt?: string | null;
};

export type TradeRow = {
  txHash?: string | null;
  logIndex?: number | null;
  blockNumber?: number | null;
  timestamp?: string | null;
  maker?: string | null;
  taker?: string | null;
  price?: string | null;
  size?: string | null;
  side?: string | null;
  outcome?: string | null;
  tokenId?: string | null;
  marketId?: number | null;
  marketTitle?: string | null;
  orderHash?: string | null;
  makerAssetId?: string | null;
  takerAssetId?: string | null;
  makerAmount?: string | number | null;
  takerAmount?: string | number | null;
  fee?: string | number | null;
  contract?: string | null;
};

export type OracleEvent = {
  id?: number;
  txHash?: string | null;
  blockNumber?: number | null;
  eventTime?: string | null;
  eventStatus?: string | null;
  externalMarketId?: string | null;
  marketId?: number | null;
  marketTitle?: string | null;
  matchedBy?: string | null;
  questionId?: string | null;
  conditionId?: string | null;
  proposedPrice?: string | number | null;
  settledPrice?: string | number | null;
  requester?: string | null;
  proposer?: string | null;
  disputer?: string | null;
  proposalTransaction?: string | null;
  settlementTransaction?: string | null;
  sourceAdapter?: string | null;
  sourceOracle?: string | null;
};

export type OraclePayload = {
  marketId: number;
  questionId?: string | null;
  oracle?: string | null;
  currentStatus?: string | null;
  timeline: OracleEvent[];
};

export type PriceSummary = {
  marketId: number;
  latestPrice?: string | null;
  latestYesPrice?: string | null;
  latestNoPrice?: string | null;
  change1h?: string | null;
  change24h?: string | null;
  volume24h?: string | null;
  tradeCount24h?: number;
  updatedAt?: string | null;
};

export type ChartPoint = {
  timestamp: string;
  yesPrice?: string | number | null;
  noPrice?: string | number | null;
  value?: string | number | null;
};

export type ChartPayload = {
  marketId: number;
  range: string;
  interval: string;
  kind?: 'probability' | 'underlying-price' | string;
  sourceSymbol?: string | null;
  sourceLabel?: string | null;
  pairLabel?: string | null;
  currentUnderlyingPrice?: string | number | null;
  underlyingChangePercent?: number | null;
  targetPrice?: string | number | null;
  targetLabel?: string | null;
  referenceRule?: string | null;
  points: ChartPoint[];
};

export type ContentItem = {
  id?: string | number;
  contentType?: string | null;
  source?: string | null;
  title?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  summary?: string | null;
};

export type ContentPayload = {
  marketId: number;
  items: ContentItem[];
  sourceMode?: string;
};

export type SystemHealth = {
  database?: string;
  redis?: boolean;
  apiStatus?: string;
  lobRuntime?: { status?: string; mode?: string };
  contentSync?: { status?: string };
  marketSync?: { updatedAt?: string | null };
  tradeSync?: { updatedAt?: string | null };
  oracleSync?: { updatedAt?: string | null };
  priceSync?: { status?: string; updatedAt?: string | null };
};

export type L2Level = {
  price?: string | number | null;
  size?: string | number | null;
};

export type LobSide = {
  bestBid?: string | number | null;
  bestAsk?: string | number | null;
  spread?: string | number | null;
  bids?: L2Level[];
  asks?: L2Level[];
};

export type LobPayload = {
  marketId: number;
  marketTitle?: string;
  fetchedAt?: string;
  yes?: LobSide;
  no?: LobSide;
};

export type WorkspaceBundle = {
  market: MarketSummary | null;
  trades: TradeRow[];
  oracle: OraclePayload | null;
  price: PriceSummary | null;
  chart: ChartPayload | null;
  content: ContentPayload | null;
  lob: LobPayload | null;
};

export type SparkPoint = {
  timestamp: string;
  value: number;
};

export type RuntimeMarketTicker = {
  id: string;
  label: string;
  symbol: string;
  price?: number | null;
  changePercent?: number | null;
  points: SparkPoint[];
};

export type RuntimeMarketGroup = {
  kind: string;
  items: RuntimeMarketTicker[];
  generatedAt?: string;
};

export type RuntimeF1PanelCard = {
  id?: string;
  kind?: 'meeting' | 'session' | 'result' | 'news' | string;
  status?: 'live' | 'upcoming' | 'completed' | string;
  topic?: string | null;
  phase?: string | null;
  detail?: string | null;
  title?: string | null;
  summary?: string | null;
  primaryMetric?: string | null;
  secondaryMetric?: string | null;
  tertiaryMetric?: string | null;
  quaternaryMetric?: string | null;
  accentColor?: string | null;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
};

export type RuntimeF1Meeting = {
  meetingKey?: number | null;
  meetingName?: string | null;
  officialName?: string | null;
  location?: string | null;
  countryName?: string | null;
  circuitName?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: string | null;
};

export type RuntimeF1Payload = {
  generatedAt?: string;
  season?: number;
  source?: string | null;
  sourceUrl?: string | null;
  status?: string | null;
  focusMeeting?: RuntimeF1Meeting | null;
  cards: RuntimeF1PanelCard[];
};

export type RuntimeJin10Item = {
  id: string;
  timestamp?: string | null;
  headline?: string | null;
  summary?: string | null;
  source?: string | null;
  url?: string | null;
  important?: boolean;
  locked?: boolean;
  vipLevel?: number | string | null;
  assetHints?: string[];
  channelIds?: number[];
};

export type RuntimeJin10Payload = {
  generatedAt?: string;
  source?: string | null;
  sourceUrl?: string | null;
  status?: string | null;
  items: RuntimeJin10Item[];
};

export type RuntimeNbaGame = {
  id?: string;
  name?: string;
  status?: string;
  state?: string;
  tipoff?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: string | number | null;
  awayScore?: string | number | null;
  broadcast?: string | null;
};

export type RuntimeNbaPayload = {
  items: RuntimeNbaGame[];
  generatedAt?: string;
};

export type RuntimeNbaIntelItem = {
  headline?: string;
  description?: string | null;
  publishedAt?: string | null;
  url?: string | null;
  source?: string | null;
  type?: string | null;
};

export type RuntimeNbaLineupPlayer = {
  side?: string;
  playerName?: string;
  position?: string;
  lineupStatus?: string;
  timestamp?: string | null;
};

export type RuntimeNbaLineupGame = {
  gameId?: string | number | null;
  label?: string;
  status?: string | null;
  starters: RuntimeNbaLineupPlayer[];
};

export type RuntimeNbaIntelPayload = {
  items: RuntimeNbaIntelItem[];
  lineups: RuntimeNbaLineupGame[];
  generatedAt?: string;
};

export type RuntimeInflationNowcastRow = {
  [key: string]: string | undefined;
};

export type RuntimeInflationNowcastPayload = {
  monthOverMonth?: RuntimeInflationNowcastRow | null;
  yearOverYear?: RuntimeInflationNowcastRow | null;
  quarterly?: RuntimeInflationNowcastRow[];
  generatedAt?: string;
  source?: string;
  url?: string;
};

export type RuntimeTradeSignal = {
  marketId?: number | null;
  marketTitle?: string | null;
  timestamp?: string | null;
  txHash?: string | null;
  eventTime?: string | null;
  eventStatus?: string | null;
  side?: string | null;
  outcome?: string | null;
  price?: string | null;
  size?: string | null;
  notional?: string | null;
  severity?: string | null;
  title?: string | null;
  summary?: string | null;
  kind?: string | null;
  bias?: string | null;
  sourceLabel?: string | null;
  sourceTag?: string | null;
  headline?: string | null;
  action?: RuntimeSignalAction | null;
  contributors?: string[];
  addresses?: RuntimeSignalAddress[];
  relatedContent?: RuntimeSignalContent[];
  metrics?: RuntimeSignalMetrics | null;
};

export type RuntimeSignalAction = {
  label?: string | null;
  outcome?: string | null;
};

export type RuntimeSignalAddress = {
  address?: string | null;
  shortAddress?: string | null;
  labels?: string[];
  tradeCount?: number | string | null;
  volumeNotional?: string | null;
  marketTradeCount?: number | string | null;
  marketVolumeNotional?: string | null;
  firstTradeAt?: string | null;
  firstMarketTradeAt?: string | null;
  isNewAddress?: boolean;
  isNewToMarket?: boolean;
};

export type RuntimeSignalContent = {
  source?: string | null;
  title?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  summary?: string | null;
};

export type RuntimeSignalMetrics = {
  totalNotional?: string | null;
  avgPrice?: string | null;
  currentProbability?: string | null;
  accountCount?: number | string | null;
  newAccountCount?: number | string | null;
  newToMarketCount?: number | string | null;
  tradeCount?: number | string | null;
  score?: string | null;
};

export type RuntimeSignalPayload = {
  items: RuntimeTradeSignal[];
  generatedAt?: string;
};

export type PanelDefinition = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  size?: 'default' | 'wide' | 'tall';
};

export type PanelRenderContext = {
  bootstrap: BootstrapPayload | null;
  markets: MarketListItem[];
  selectedMarketId: number | null;
  setSelectedMarketId: (marketId: number) => void;
  selectedMarket: MarketSummary | null;
  bundle: WorkspaceBundle | null;
  health: SystemHealth | null;
  globalTrades: TradeRow[];
  globalOracle: OracleEvent[];
  latestContent: ContentItem[];
  commodities?: RuntimeMarketGroup | null;
  crypto?: RuntimeMarketGroup | null;
  f1?: RuntimeF1Payload | null;
  jin10?: RuntimeJin10Payload | null;
  nba?: RuntimeNbaPayload | null;
  nbaIntel?: RuntimeNbaIntelPayload | null;
  inflationNowcast?: RuntimeInflationNowcastPayload | null;
  alphaSignals?: RuntimeSignalPayload | null;
  whaleTrades?: RuntimeSignalPayload | null;
  suspiciousTrades?: RuntimeSignalPayload | null;
};
