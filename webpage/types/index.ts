export interface Market {
  id: number;
  slug: string;
  title: string;
  conditionId: string;
  questionId: string;
  oracle: string;
  yesTokenId: string;
  noTokenId: string;
  description: string;
  status: "Active" | "Proposed" | "Settled" | "Closed" | "Unknown";
  latestPrice?: string | null;
  latestYesPrice?: string | null;
  latestNoPrice?: string | null;
  enableNegRisk: boolean;
  endDate?: string | null;
  createdAt?: string | null;
  category: string;
  tags: string[];
  gammaMarketId?: string | null;
}

export interface Trade {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: string;
  maker: string;
  taker: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  outcome: "YES" | "NO" | null;
  tokenId: string;
  marketId: number;
  orderHash?: string | null;
  makerAssetId?: string | null;
  takerAssetId?: string | null;
  makerAmount?: string | number | null;
  takerAmount?: string | number | null;
  fee?: string | number | null;
  contract?: string | null;
}

export interface OracleEvent {
  id: number;
  txHash: string;
  blockNumber: number;
  eventTime: string;
  eventStatus: "request" | "propose" | "dispute" | "settle" | string;
  externalMarketId?: string | null;
  marketId: number;
  marketTitle?: string | null;
  matchedBy?: string | null;
  questionId?: string | null;
  conditionId?: string | null;
  proposedPrice?: string | null;
  settledPrice?: string | null;
  requester?: string | null;
  proposer?: string | null;
  disputer?: string | null;
  proposalTransaction?: string | null;
  settlementTransaction?: string | null;
  sourceAdapter?: string | null;
  sourceOracle?: string | null;
}

export interface PricePoint {
  timestamp: string;
  yesPrice?: string | null;
  noPrice?: string | null;
}

export interface DashboardMetrics {
  activeMarkets: number;
  totalTrades: number;
  settlements24h: number;
}

export interface VolumePoint {
  day: string;
  trade_count: number;
}

export interface StatusShare {
  name: string;
  value: number;
}

export interface RecentMarket {
  id: number;
  slug: string;
  title: string;
  tradeCount: number;
  lastTradeAt: string;
  status: string;
  endDate?: string | null;
  latestPrice?: string | null;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  volume7d: VolumePoint[];
  volume30d: VolumePoint[];
  statusShare: StatusShare[];
  recentActiveMarkets: RecentMarket[];
}

export interface MarketListItem {
  id: number;
  slug: string;
  title: string;
  conditionId: string;
  questionId: string;
  endDate?: string | null;
  latestPrice?: string | null;
  status: string;
  category: string;
  tags: string[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore?: boolean;
}

export interface MarketListResponse {
  items: MarketListItem[];
  pagination: Pagination;
}

export interface MarketDetailResponse {
  market: Market;
  priceSeries: PricePoint[];
  trades: Trade[];
  oracleEvents: OracleEvent[];
}

export interface SearchResult {
  id: number;
  slug: string;
  title: string;
  conditionId: string;
  questionId: string;
}

export interface SearchResponse {
  items: SearchResult[];
}