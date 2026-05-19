import type {
  BootstrapPayload,
  ChartPayload,
  ContentPayload,
  LobPayload,
  MarketAiInsightPayload,
  MarketAiInsightResponse,
  MarketWideAiInsightPayload,
  MarketWideAiInsightResponse,
  MarketSummary,
  MarketGroupChartPayload,
  MarketGroupDetail,
  MarketGroupsPayload,
  MarketsPayload,
  OraclePayload,
  PriceSummary,
  RuntimeMarketGroup,
  RuntimeCryptoFundingPayload,
  RuntimeCpiReleaseCalendarPayload,
  RuntimeEnergyGasolineShockPayload,
  RuntimeGlobalWeatherMapPayload,
  RuntimeGridEsportsPayload,
  RuntimeFoodRetailBasketPayload,
  RuntimeGeoSanctionsShockPayload,
  RuntimeInflationNowcastPayload,
  RuntimeF1Payload,
  RuntimeJin10Payload,
  RuntimeMacroDriverPayload,
  RuntimeMacroRegistryPayload,
  RuntimeNbaMatchupPredictorPayload,
  RuntimeNbaPayload,
  RuntimeNbaIntelPayload,
  RuntimeNewMarketSignalsPayload,
  RuntimePolymarketMacroMapPayload,
  RuntimeSignalPayload,
  RuntimeSportsOddsPayload,
  RuntimeWeatherNewsPayload,
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

async function apiPostWithTimeout<T>(path: string, body: unknown, timeoutMs = 18000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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

export function fetchRuntimeGridEsports(limit = 10) {
  return apiGet<RuntimeGridEsportsPayload>(`/runtime/esports/grid-intel?limit=${limit}`);
}

export function fetchRuntimeSportsOdds(limit = 8) {
  return apiGet<RuntimeSportsOddsPayload>(`/runtime/sports/odds-monitor?limit=${limit}`);
}

export function fetchRuntimeInflationNowcast() {
  return apiGet<RuntimeInflationNowcastPayload>('/runtime/macro/inflation-nowcast');
}

export function fetchRuntimePolymarketMacroMap(limit = 12) {
  return apiGet<RuntimePolymarketMacroMapPayload>(`/runtime/macro/polymarket-map?limit=${limit}`);
}

export function fetchRuntimeCpiReleaseCalendar(limit = 8) {
  return apiGet<RuntimeCpiReleaseCalendarPayload>(`/runtime/macro/cpi-release-calendar?limit=${limit}`);
}

export function fetchRuntimeEnergyGasolineShock(limit = 6) {
  return apiGet<RuntimeEnergyGasolineShockPayload>(`/runtime/macro/energy-gasoline-shock?limit=${limit}`);
}

export function fetchRuntimeGlobalWeatherMap(limit = 34) {
  return apiGet<RuntimeGlobalWeatherMapPayload>(`/runtime/weather/global-map?limit=${limit}`);
}

export function fetchRuntimeGlobalTemperatureMonitor(limit = 34) {
  return apiGet<RuntimeGlobalWeatherMapPayload>(`/runtime/weather/temperature-monitor?limit=${limit}`);
}

export function fetchRuntimeWeatherNews(limit = 24) {
  return apiGet<RuntimeWeatherNewsPayload>(`/runtime/weather/news?limit=${limit}`);
}

export function fetchRuntimeFoodRetailBasket(limit = 8) {
  return apiGet<RuntimeFoodRetailBasketPayload>(`/runtime/macro/food-retail-basket?limit=${limit}`);
}

export function fetchRuntimeSupplyTariffImportWatch(limit = 8) {
  return apiGet<RuntimeMacroDriverPayload>(`/runtime/macro/supply-tariff-import-watch?limit=${limit}`);
}

export function fetchRuntimeShelterRentOerPressure(limit = 8) {
  return apiGet<RuntimeMacroDriverPayload>(`/runtime/macro/shelter-rent-oer-pressure?limit=${limit}`);
}

export function fetchRuntimeLaborWageServicesPressure(limit = 8) {
  return apiGet<RuntimeMacroDriverPayload>(`/runtime/macro/labor-wage-services-pressure?limit=${limit}`);
}

export function fetchRuntimeGrowthDemandRecessionTracker(limit = 8) {
  return apiGet<RuntimeMacroDriverPayload>(`/runtime/macro/growth-demand-recession-tracker?limit=${limit}`);
}

export function fetchRuntimeFedRatesPolymarketGap(limit = 8) {
  return apiGet<RuntimeMacroDriverPayload>(`/runtime/macro/fed-rates-polymarket-gap?limit=${limit}`);
}

export function fetchRuntimeCpiReleaseCommandCenter(limit = 36) {
  return apiGet<RuntimeMacroRegistryPayload>(`/runtime/macro/cpi-release-command-center?limit=${limit}`);
}

export function fetchRuntimeCpiComponentsPressureRegistry(limit = 48) {
  return apiGet<RuntimeMacroRegistryPayload>(`/runtime/macro/cpi-components-pressure-registry?limit=${limit}`);
}

export function fetchRuntimeGoodsTariffSupplyWatch(limit = 36) {
  return apiGet<RuntimeMacroRegistryPayload>(`/runtime/macro/goods-tariff-supply-watch?limit=${limit}`);
}

export function fetchRuntimeLaborServicesInflationMonitor(limit = 36) {
  return apiGet<RuntimeMacroRegistryPayload>(`/runtime/macro/labor-services-inflation-monitor?limit=${limit}`);
}

export function fetchRuntimeFedReactionGrowthRiskBoard(limit = 36) {
  return apiGet<RuntimeMacroRegistryPayload>(`/runtime/macro/fed-reaction-growth-risk-board?limit=${limit}`);
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

export type RuntimePanelsPayload = {
  generatedAt?: string;
  status?: string;
  panels?: Record<string, unknown>;
  errors?: Record<string, string>;
};

export function fetchRuntimePanels(panelIds: string[], limits: Record<string, number> = {}) {
  const ids = [...new Set(panelIds.map((panelId) => panelId.trim()).filter(Boolean))];
  const params = new URLSearchParams({ ids: ids.join(',') });
  ids.forEach((panelId) => {
    const limit = limits[panelId];
    if (typeof limit === 'number' && Number.isFinite(limit)) params.set(`limit.${panelId}`, String(limit));
  });
  return apiGet<RuntimePanelsPayload>(`/runtime/panels?${params.toString()}`);
}

export function fetchMarketSummary(marketId: number, timeoutMs = 3500) {
  return apiGetWithTimeout<MarketSummary>(`/markets/${marketId}`, timeoutMs);
}

type MarketDetailBundlePayload = {
  market?: MarketSummary | null;
  price?: PriceSummary | null;
  chart?: ChartPayload | null;
  priceSeries?: ChartPayload['points'];
  trades?: TradeRow[];
  oracle?: OraclePayload | null;
  oracleEvents?: OraclePayload['timeline'];
  content?: ContentPayload | null;
};

export async function fetchMarketDetailBundle(marketId: number, timeoutMs = 6500): Promise<WorkspaceBundle> {
  const payload = await apiGetWithTimeout<MarketDetailBundlePayload>(`/markets/${marketId}/detail`, timeoutMs);
  const chart = payload.chart || (
    payload.priceSeries
      ? {
          marketId,
          localMarketId: marketId,
          range: '1d',
          interval: '5m',
          kind: 'probability',
          points: payload.priceSeries,
        }
      : null
  );
  return {
    market: payload.market || null,
    price: payload.price || null,
    chart,
    trades: payload.trades || [],
    oracle: payload.oracle || (
      payload.oracleEvents
        ? {
            marketId,
            localMarketId: marketId,
            timeline: payload.oracleEvents,
          }
        : null
    ),
    content: payload.content || null,
    lob: null,
  };
}

export function fetchMarketPrice(marketId: number, timeoutMs = 5000) {
  return apiGetWithTimeout<PriceSummary>(`/markets/${marketId}/price`, timeoutMs);
}

export function fetchMarketChart(marketId: number, timeoutMs = 5000) {
  return apiGetWithTimeout<ChartPayload>(`/markets/${marketId}/chart?range=1d&interval=5m`, timeoutMs);
}

export function fetchMarketTrades(marketId: number, limit = 24, timeoutMs = 4000) {
  return apiGetWithTimeout<TradeRow[]>(`/markets/${marketId}/trades?limit=${limit}`, timeoutMs);
}

export function fetchMarketOracle(marketId: number, timeoutMs = 2200) {
  return apiGetWithTimeout<OraclePayload>(`/markets/${marketId}/oracle`, timeoutMs);
}

export function fetchMarketContent(marketId: number, limit = 20, timeoutMs = 5000) {
  return apiGetWithTimeout<ContentPayload>(`/content/market/${marketId}?limit=${limit}`, timeoutMs);
}

export function fetchMarketLob(marketId: number, timeoutMs = 4000) {
  return apiGetWithTimeout<LobPayload>(`/runtime/lob/${marketId}`, timeoutMs);
}

export function fetchMarketLobByToken(tokenId: string, title = '', noTokenId = '', timeoutMs = 4000) {
  const params = new URLSearchParams();
  if (title.trim()) params.set('title', title.trim());
  if (noTokenId.trim()) params.set('noTokenId', noTokenId.trim());
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiGetWithTimeout<LobPayload>(`/runtime/lob/token/${encodeURIComponent(tokenId)}${suffix}`, timeoutMs);
}

function preferLoadedBundle(primary: WorkspaceBundle, secondary: WorkspaceBundle): WorkspaceBundle {
  return {
    market: primary.market || secondary.market,
    price: primary.price || secondary.price,
    chart: primary.chart?.points?.length ? primary.chart : secondary.chart,
    trades: primary.trades?.length ? primary.trades : secondary.trades,
    oracle: primary.oracle?.timeline?.length ? primary.oracle : secondary.oracle,
    content: primary.content?.items?.length ? primary.content : secondary.content,
    lob: primary.lob || secondary.lob,
  };
}

const workspaceBundleInflight = new Map<string, Promise<WorkspaceBundle>>();

export function fetchMarketAiInsights(payload: MarketAiInsightPayload, timeoutMs = 20000) {
  return apiPostWithTimeout<MarketAiInsightResponse>('/agent/market-insights', payload, timeoutMs);
}

export function fetchMarketWideAiInsights(payload: MarketWideAiInsightPayload, timeoutMs = 24000) {
  return apiPostWithTimeout<MarketWideAiInsightResponse>('/agent/market-wide-insights', payload, timeoutMs);
}

export async function fetchWorkspaceBundle(marketId: number, options: { includeContent?: boolean; includeLob?: boolean } = {}): Promise<WorkspaceBundle> {
  const includeContent = Boolean(options.includeContent);
  const includeLob = Boolean(options.includeLob);
  const inflightKey = `${marketId}:${includeContent ? 'content' : 'base'}:${includeLob ? 'lob' : 'no-lob'}`;
  const inflight = workspaceBundleInflight.get(inflightKey);
  if (inflight) return inflight;

  const request = (async () => {
    const detailBundle = await fetchMarketDetailBundle(marketId, 6500);
    const contentPromise = includeContent
      ? (
          detailBundle.content?.items?.length
            ? Promise.resolve(detailBundle.content)
            : fetchMarketContent(marketId, 20, 5000)
        )
      : Promise.resolve(null);
    const lobPromise = includeLob ? fetchMarketLob(marketId, 2600) : Promise.resolve(null);
    const [contentResult, lobResult] = await Promise.allSettled([contentPromise, lobPromise]);
    const secondary: WorkspaceBundle = {
      market: null,
      price: null,
      chart: null,
      trades: [],
      oracle: null,
      content: contentResult.status === 'fulfilled' ? contentResult.value : null,
      lob: includeLob && lobResult.status === 'fulfilled' ? lobResult.value : null,
    };
    return preferLoadedBundle(detailBundle, secondary);
  })();

  workspaceBundleInflight.set(inflightKey, request);
  void request.finally(() => workspaceBundleInflight.delete(inflightKey));
  return request;
}
