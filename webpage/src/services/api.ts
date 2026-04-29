import type {
  BootstrapPayload,
  ChartPayload,
  ContentPayload,
  LobPayload,
  MarketSummary,
  MarketGroupChartPayload,
  MarketGroupDetail,
  MarketGroupsPayload,
  MarketsPayload,
  OraclePayload,
  PriceSummary,
  RuntimeMarketGroup,
  RuntimeCryptoFundingPayload,
  RuntimeGeoSanctionsShockPayload,
  RuntimeInflationNowcastPayload,
  RuntimeF1Payload,
  RuntimeJin10Payload,
  RuntimeNbaMatchupPredictorPayload,
  RuntimeNbaPayload,
  RuntimeNbaIntelPayload,
  RuntimeNewMarketSignalsPayload,
  RuntimeSignalPayload,
  SystemHealth,
  TradeRow,
  WorkspaceBundle,
} from '@/types';

const RAW_BASE = import.meta.env.DEV
  ? '/wm-api'
  : (import.meta.env.VITE_POLYDATA_API_BASE_URL || '/wm-api');
const API_BASE = RAW_BASE.endsWith('/') ? RAW_BASE.slice(0, -1) : RAW_BASE;

async function apiGetWithTimeout<T>(path: string, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timer));
  if (!response.ok) {
    throw new Error(`API ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

async function apiGet<T>(path: string): Promise<T> {
  return apiGetWithTimeout<T>(path, 12000);
}

export function fetchBootstrap() {
  return apiGet<BootstrapPayload>('/bootstrap');
}

export function fetchMarkets(query = '', pageSize = 160) {
  return fetchMarketsPage(1, query, pageSize);
}

export function fetchMarketsPage(page = 1, query = '', pageSize = 160) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    status: 'active',
  });
  if (query.trim()) params.set('q', query.trim());
  return apiGet<MarketsPayload>(`/markets?${params.toString()}`);
}

export async function fetchAllActiveMarkets(query = '', pageSize = 160, maxPages = 8) {
  const items: MarketsPayload['items'] = [];
  let page = 1;
  let total = 0;
  let totalPages = 1;
  let hasMore = false;

  do {
    const payload = await fetchMarketsPage(page, query, pageSize);
    items.push(...(payload.items || []));
    total = payload.pagination?.total || items.length;
    totalPages = payload.pagination?.totalPages || page;
    hasMore = Boolean(payload.pagination?.hasMore);
    page += 1;
  } while (hasMore && page <= maxPages);

  return {
    items,
    pagination: {
      page: 1,
      pageSize: items.length,
      total,
      totalPages,
      hasMore,
    },
  } satisfies MarketsPayload;
}

export function fetchMarketGroups(query = '', pageSize = 80, sort: 'active' | 'new' | 'volume' = 'active') {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(pageSize),
    sort,
  });
  if (query.trim()) params.set('q', query.trim());
  return apiGet<MarketGroupsPayload>(`/market-groups?${params.toString()}`);
}

export function fetchMarketGroupDetail(eventId: string, timeoutMs = 12000) {
  return apiGetWithTimeout<MarketGroupDetail>(`/market-groups/${encodeURIComponent(eventId)}/detail`, timeoutMs);
}

export function fetchMarketGroupChart(eventId: string, range: '1h' | '6h' | '1d' | '1w' | '1m' | 'all' = '1d', timeoutMs = 12000) {
  return apiGetWithTimeout<MarketGroupChartPayload>(
    `/market-groups/${encodeURIComponent(eventId)}/chart?range=${encodeURIComponent(range)}`,
    timeoutMs,
  );
}

export function fetchSystemHealth() {
  return apiGet<SystemHealth>('/system/health');
}

export function fetchRecentTrades(limit = 24) {
  return apiGet<TradeRow[]>(`/trades/recent?limit=${limit}`);
}

export function fetchRecentOracle(limit = 24) {
  return apiGet<OraclePayload['timeline']>(`/oracle/recent?limit=${limit}`);
}

export function fetchLatestContent(limit = 8) {
  return apiGet<ContentPayload>(`/content/latest?limit=${limit}`);
}

export function fetchRuntimeCommodities() {
  return apiGet<RuntimeMarketGroup>('/runtime/markets/commodities');
}

export function fetchRuntimeCrypto() {
  return apiGet<RuntimeMarketGroup>('/runtime/markets/crypto');
}

export function fetchRuntimeCryptoFundingWatch(limit = 18) {
  return apiGet<RuntimeCryptoFundingPayload>(`/runtime/crypto/funding-watch?limit=${limit}`);
}

export function fetchRuntimeF1(limit = 10) {
  return apiGet<RuntimeF1Payload>(`/runtime/sports/f1?limit=${limit}`);
}

export function fetchRuntimeJin10(limit = 24) {
  return apiGet<RuntimeJin10Payload>(`/runtime/macro/jin10?limit=${limit}`);
}

export function fetchRuntimeNba(limit = 10) {
  return apiGet<RuntimeNbaPayload>(`/runtime/sports/nba?limit=${limit}`);
}

export function fetchRuntimeNbaIntel(limit = 12) {
  return apiGet<RuntimeNbaIntelPayload>(`/runtime/sports/nba-intel?limit=${limit}`);
}

export function fetchRuntimeNbaMatchupPredictor(limit = 8) {
  return apiGet<RuntimeNbaMatchupPredictorPayload>(`/runtime/sports/nba-matchup-predictor?limit=${limit}`);
}

export function fetchRuntimeInflationNowcast() {
  return apiGet<RuntimeInflationNowcastPayload>('/runtime/macro/inflation-nowcast');
}

export function fetchRuntimeGeoSanctionsShock(limit = 6) {
  return apiGet<RuntimeGeoSanctionsShockPayload>(`/runtime/world/geo-sanctions-shock?limit=${limit}`);
}

export function fetchRuntimeAlpha(limit = 8) {
  return apiGet<RuntimeSignalPayload>(`/runtime/signals/alpha?limit=${limit}`);
}

export function fetchRuntimeNewMarketSignals(limit = 12) {
  return apiGet<RuntimeNewMarketSignalsPayload>(`/runtime/markets/new-signals?limit=${limit}`);
}

export function fetchRuntimeWhales(limit = 14) {
  return apiGet<RuntimeSignalPayload>(`/runtime/trades/whales?limit=${limit}`);
}

export function fetchRuntimeSuspicious(limit = 12) {
  return apiGet<RuntimeSignalPayload>(`/runtime/trades/suspicious?limit=${limit}`);
}

export async function fetchWorkspaceBundle(marketId: number): Promise<WorkspaceBundle> {
  const marketPromise = apiGetWithTimeout<MarketSummary>(`/markets/${marketId}`, 3500);
  const pricePromise = apiGetWithTimeout<PriceSummary>(`/markets/${marketId}/price`, 5000);
  const chartPromise = apiGetWithTimeout<ChartPayload>(`/markets/${marketId}/chart?range=1d&interval=5m`, 5000);
  const tradesPromise = apiGetWithTimeout<TradeRow[]>(`/markets/${marketId}/trades?limit=24`, 4000);
  const oraclePromise = apiGetWithTimeout<OraclePayload>(`/markets/${marketId}/oracle`, 2200);
  const contentPromise = apiGetWithTimeout<ContentPayload>(`/content/market/${marketId}?limit=6`, 2200);
  const lobPromise = apiGetWithTimeout<LobPayload>(`/runtime/lob/${marketId}`, 4000);

  const [
    marketResult,
    priceResult,
    chartResult,
  ] = await Promise.allSettled([
    marketPromise,
    pricePromise,
    chartPromise,
  ]);
  const [
    tradesResult,
    oracleResult,
    contentResult,
    lobResult,
  ] = await Promise.allSettled([
    tradesPromise,
    oraclePromise,
    contentPromise,
    lobPromise,
  ]);

  if (marketResult.status !== 'fulfilled') {
    throw marketResult.reason instanceof Error
      ? marketResult.reason
      : new Error(`Failed to load market ${marketId}`);
  }

  return {
    market: marketResult.value,
    trades: tradesResult.status === 'fulfilled' ? tradesResult.value : [],
    oracle: oracleResult.status === 'fulfilled' ? oracleResult.value : null,
    price: priceResult.status === 'fulfilled' ? priceResult.value : null,
    chart: chartResult.status === 'fulfilled' ? chartResult.value : null,
    content: contentResult.status === 'fulfilled' ? contentResult.value : null,
    lob: lobResult.status === 'fulfilled' ? lobResult.value : null,
  };
}
