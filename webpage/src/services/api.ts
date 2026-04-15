import type {
  BootstrapPayload,
  ChartPayload,
  ContentPayload,
  LobPayload,
  MarketSummary,
  MarketsPayload,
  OraclePayload,
  PriceSummary,
  RuntimeMarketGroup,
  RuntimeInflationNowcastPayload,
  RuntimeNbaPayload,
  RuntimeNbaIntelPayload,
  RuntimeSignalPayload,
  SystemHealth,
  TradeRow,
  WorkspaceBundle,
} from '@/types';

const RAW_BASE = import.meta.env.DEV
  ? '/wm-api'
  : (import.meta.env.VITE_POLYDATA_API_BASE_URL || '/wm-api');
const API_BASE = RAW_BASE.endsWith('/') ? RAW_BASE.slice(0, -1) : RAW_BASE;

async function apiGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timer));
  if (!response.ok) {
    throw new Error(`API ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
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

export function fetchRuntimeNba(limit = 10) {
  return apiGet<RuntimeNbaPayload>(`/runtime/sports/nba?limit=${limit}`);
}

export function fetchRuntimeNbaIntel(limit = 12) {
  return apiGet<RuntimeNbaIntelPayload>(`/runtime/sports/nba-intel?limit=${limit}`);
}

export function fetchRuntimeInflationNowcast() {
  return apiGet<RuntimeInflationNowcastPayload>('/runtime/macro/inflation-nowcast');
}

export function fetchRuntimeAlpha(limit = 8) {
  return apiGet<RuntimeSignalPayload>(`/runtime/signals/alpha?limit=${limit}`);
}

export function fetchRuntimeWhales(limit = 14) {
  return apiGet<RuntimeSignalPayload>(`/runtime/trades/whales?limit=${limit}`);
}

export function fetchRuntimeSuspicious(limit = 12) {
  return apiGet<RuntimeSignalPayload>(`/runtime/trades/suspicious?limit=${limit}`);
}

export async function fetchWorkspaceBundle(marketId: number): Promise<WorkspaceBundle> {
  const [market, trades, oracle, price, chart, content, lob] = await Promise.all([
    apiGet<MarketSummary>(`/markets/${marketId}`),
    apiGet<TradeRow[]>(`/markets/${marketId}/trades?limit=24`),
    apiGet<OraclePayload>(`/markets/${marketId}/oracle`),
    apiGet<PriceSummary>(`/markets/${marketId}/price`),
    apiGet<ChartPayload>(`/markets/${marketId}/chart?range=1d&interval=5m`),
    apiGet<ContentPayload>(`/content/market/${marketId}?limit=6`),
    apiGet<LobPayload>(`/runtime/lob/${marketId}`).catch(() => null),
  ]);

  return { market, trades, oracle, price, chart, content, lob };
}
