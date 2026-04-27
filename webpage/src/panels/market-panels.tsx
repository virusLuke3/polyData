import { useEffect, useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { MarketListItem } from '@/types';
import type { PanelRenderMap } from './types';
import { formatCompact, formatCurrencyCompact, formatDate, formatPercent, formatRelative, formatSignedPercent, shortHash, signedClass } from './shared/formatters';
import { emptyState, priceLine } from './shared/renderers';
import { globalMarkets } from './shared/selectors';

type ImpactLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
type ScoredMarket = MarketListItem & { impactScore: number; impactLevel: ImpactLevel };
const MARKET_SORT_STORAGE_KEY = 'wm:marketSort:v3';

function numericValue(value: string | number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function percentileRanks(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return values.map((value) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((sorted[mid] ?? 0) < value) low = mid + 1;
      else high = mid;
    }
    return sorted.length > 1 ? low / (sorted.length - 1) : 0.5;
  });
}

function impactLevel(score: number): ImpactLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  if (score >= 15) return 'low';
  return 'info';
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketTradeabilityScore(latestPrice: string | number | null | undefined) {
  const probability = numericValue(latestPrice);
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return 0;
  const distanceFromMid = Math.abs(probability - 0.5);
  if (distanceFromMid <= 0.2) return 10;
  if (distanceFromMid <= 0.32) return 7;
  if (distanceFromMid <= 0.4) return 4;
  return 0;
}

function marketActivityTimestamp(market: MarketListItem) {
  return Math.max(parseTimestamp(market.lastTradeAt), parseTimestamp(market.createdAt));
}

function marketAgeHours(market: MarketListItem, now: number) {
  const createdAt = parseTimestamp(market.createdAt);
  if (!createdAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - createdAt) / (1000 * 60 * 60));
}

function marketRecencyScore(ageHours: number) {
  if (ageHours < 6) return 45;
  if (ageHours < 24) return 42;
  if (ageHours < 72) return 35;
  if (ageHours < 24 * 7) return 28;
  if (ageHours < 24 * 14) return 20;
  if (ageHours < 24 * 30) return 10;
  return 0;
}

function oldMarketPenalty(ageHours: number) {
  if (ageHours > 24 * 180) return 45;
  if (ageHours > 24 * 90) return 30;
  if (ageHours > 24 * 30) return 15;
  return 0;
}

function terminalMarketPenalty(market: MarketListItem, ageHours: number) {
  const probability = numericValue(market.latestPrice);
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return ageHours > 24 * 7 ? 12 : 4;
  if (probability <= 0.02 || probability >= 0.98) return ageHours > 24 * 7 ? 18 : 6;
  if (probability <= 0.05 || probability >= 0.95) return ageHours > 24 * 30 ? 10 : 3;
  return 0;
}

function scoreMarkets(markets: MarketListItem[]): ScoredMarket[] {
  if (!markets.length) return [];
  const now = Date.now();
  const volumeValues = markets.map((market) => Math.log1p(Math.max(0, numericValue(market.volume24h))));
  const changeValues = markets.map((market) => Math.abs(numericValue(market.change24h)));
  const tradesValues = markets.map((market) => Math.log1p(Math.max(0, numericValue(market.tradeCount24h))));

  const volumeRanks = percentileRanks(volumeValues);
  const changeRanks = percentileRanks(changeValues);
  const tradesRanks = percentileRanks(tradesValues);

  return markets.map((market, index) => {
    const ageHours = marketAgeHours(market, now);
    const recencyScore = marketRecencyScore(ageHours);

    const score = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          recencyScore +
          tradesRanks[index]! * 20 +
          volumeRanks[index]! * 15 +
          changeRanks[index]! * 10 +
          marketTradeabilityScore(market.latestPrice) -
          oldMarketPenalty(ageHours) -
          terminalMarketPenalty(market, ageHours),
        ),
      ),
    );

    return {
      ...market,
      impactScore: score,
      impactLevel: impactLevel(score),
    };
  });
}

function marketTopic(market: MarketListItem) {
  const tag = market.tags?.find((item) => String(item || '').trim());
  return String(tag || market.category || market.status || 'market').toLowerCase();
}

function marketTiming(market: MarketListItem) {
  if (market.createdAt) return formatRelative(market.createdAt);
  if (market.lastTradeAt) return `${formatRelative(market.lastTradeAt)} trade`;
  if (market.endDate) return `closes ${formatRelative(market.endDate)}`;
  return '--';
}

function marketOutcomeLabel(market: MarketListItem) {
  const count = Number(market.outcomeCount || 0);
  if (count > 0) return `${count} outcomes`;
  return 'binary';
}

function marketAccent(market: MarketListItem) {
  const topic = marketTopic(market);
  if (topic.includes('crypto')) return '#f59e0b';
  if (topic.includes('sport')) return '#22c55e';
  if (topic.includes('politic') || topic.includes('election')) return '#60a5fa';
  if (topic.includes('finance') || topic.includes('fed') || topic.includes('macro')) return '#eab308';
  if (topic.includes('tech') || topic.includes('ai')) return '#a78bfa';
  return '#22c55e';
}

function activeMarketsList(markets: ScoredMarket[], selectedMarketId: number | null, setSelectedMarketId: (marketId: number) => void) {
  if (!markets.length) return emptyState('No active markets yet.');
  return (
    <div className="wm-poly-market-list">
      {markets.map((market) => (
        <button
          key={market.id}
          type="button"
          className={`wm-poly-market-card ${selectedMarketId === market.id ? 'active' : ''}`}
          onClick={() => setSelectedMarketId(market.id)}
          aria-pressed={selectedMarketId === market.id}
          title={market.title}
          style={{ borderLeftColor: marketAccent(market) }}
        >
          <div className="wm-poly-market-card-main">
            <div className="wm-poly-market-meta">
              <span className="wm-poly-market-dot" />
              <span>{marketTopic(market)}</span>
              <span>·</span>
              <span>{marketTiming(market)}</span>
              <span>·</span>
              <span>{marketOutcomeLabel(market)}</span>
            </div>
            <strong className="wm-poly-market-title">{market.title}</strong>
            <div className="wm-poly-market-bottom">
              <span className="wm-poly-market-prob">{formatPercent(market.latestPrice)}</span>
              <span className="wm-poly-market-outcome">{shortHash(market.slug || market.conditionId || '', 18, 0)}</span>
              <span className={`wm-poly-market-change ${signedClass(market.change24h)}`}>{formatSignedPercent(market.change24h)}</span>
              <span className="wm-poly-market-volume">vol {formatCurrencyCompact(market.volume24h)} 24h</span>
              <span className="wm-poly-market-trades">{formatCompact(market.tradeCount24h)} tx</span>
            </div>
          </div>
          <span className="wm-poly-market-star" aria-hidden="true">☆</span>
        </button>
      ))}
    </div>
  );
}

type ActiveMarketSort = 'impact' | 'volume' | 'change' | 'new';

function ActiveMarketsPanel({
  markets,
  selectedMarketId,
  setSelectedMarketId,
}: {
  markets: MarketListItem[];
  selectedMarketId: number | null;
  setSelectedMarketId: (marketId: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<ActiveMarketSort>('impact');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MARKET_SORT_STORAGE_KEY);
      if (saved && ['volume', 'impact', 'change', 'new'].includes(saved)) {
        setSortOrder(saved as ActiveMarketSort);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MARKET_SORT_STORAGE_KEY, sortOrder);
    } catch {
      return;
    }
  }, [sortOrder]);

  const visibleMarkets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? markets.filter((market) => {
          const haystack = [
            market.title,
            market.slug,
            market.category,
            market.status,
            ...(market.tags || []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        })
      : [...markets];
    const scored = scoreMarkets(filtered);

    if (sortOrder === 'volume') {
      return scored.sort(
        (a, b) =>
          Number(b.volume24h || 0) - Number(a.volume24h || 0) ||
          Number(b.tradeCount24h || 0) - Number(a.tradeCount24h || 0) ||
          marketActivityTimestamp(b) - marketActivityTimestamp(a)
      );
    }
    if (sortOrder === 'change') {
      return scored
        .filter((market) => Number.isFinite(Number(market.change24h)))
        .sort(
          (a, b) =>
            Math.abs(Number(b.change24h || 0)) - Math.abs(Number(a.change24h || 0)) ||
            Number(b.volume24h || 0) - Number(a.volume24h || 0)
        );
    }
    if (sortOrder === 'new') {
      return scored.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    return scored.sort(
      (a, b) =>
        b.impactScore - a.impactScore ||
        marketActivityTimestamp(b) - marketActivityTimestamp(a) ||
        Number(b.tradeCount24h || 0) - Number(a.tradeCount24h || 0) ||
        Math.abs(Number(b.change24h || 0)) - Math.abs(Number(a.change24h || 0)) ||
        marketTradeabilityScore(b.latestPrice) - marketTradeabilityScore(a.latestPrice) ||
        Number(b.volume24h || 0) - Number(a.volume24h || 0)
    );
  }, [markets, search, sortOrder]);

  return (
    <Panel
      title="MARKETS"
      badge="LIVE"
      status="live"
      count={visibleMarkets.length}
      className="wm-market-panel"
      controls={
        <div className="wm-market-panel-controls">
          <label className="wm-market-search" aria-label="Search markets">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="7" cy="7" r="4.8" />
              <path d="M10.8 10.8 14 14" />
            </svg>
            <input
              type="search"
              value={search}
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="search..."
            />
          </label>
          <select
            className="wm-market-sort"
            value={sortOrder}
            onInput={(event) => setSortOrder(event.currentTarget.value as ActiveMarketSort)}
            aria-label="Sort markets"
          >
            <option value="impact">Impact</option>
            <option value="volume">Volume</option>
            <option value="change">Change</option>
            <option value="new">Newest</option>
          </select>
        </div>
      }
    >
      {activeMarketsList(visibleMarkets, selectedMarketId, setSelectedMarketId)}
    </Panel>
  );
}


export const marketPanelRenderers: PanelRenderMap = {
  'active-markets': {
    render: (ctx) => (
      <ActiveMarketsPanel
        markets={globalMarkets(ctx)}
        selectedMarketId={ctx.selectedMarketId}
        setSelectedMarketId={ctx.setSelectedMarketId}
      />
    ),
  },
  'featured-market': {
    render: (ctx) => (
      <Panel title="FEATURED MARKET" badge={ctx.selectedMarket?.status || 'ACTIVE'} status="live">
        <div className="wm-feature-panel">
          <div className="wm-feature-hero">
            <span className="wm-feature-kicker">{ctx.selectedMarket?.category || 'market focus'}</span>
            <strong>{ctx.selectedMarket?.title || 'No market selected.'}</strong>
            <div className="wm-feature-foot">
              <span>{formatPercent(ctx.bundle?.price?.latestPrice || ctx.bootstrap?.pricePreview?.latestPrice)}</span>
              <em>{ctx.selectedMarket?.endDate ? formatRelative(ctx.selectedMarket.endDate) : 'rolling'}</em>
            </div>
          </div>
          <div className="wm-feature-grid">
            <article className="wm-feature-stat">
              <span>CATEGORY</span>
              <strong>{ctx.selectedMarket?.category || '--'}</strong>
            </article>
            <article className="wm-feature-stat">
              <span>PRICE</span>
              <strong>{formatPercent(ctx.bundle?.price?.latestPrice || ctx.bootstrap?.pricePreview?.latestPrice)}</strong>
            </article>
            <article className="wm-feature-stat">
              <span>VOLUME</span>
              <strong>{formatCurrencyCompact(globalMarkets(ctx).find((market) => market.id === ctx.selectedMarketId)?.volume24h)}</strong>
            </article>
            <article className="wm-feature-stat">
              <span>END</span>
              <strong>{formatDate(ctx.selectedMarket?.endDate || null)}</strong>
            </article>
          </div>
        </div>
      </Panel>
    ),
  },
  'market-summary': {
    render: (ctx) => (
      <Panel title="MARKET SUMMARY" badge="MARKET" status="live">
        <div className="wm-detail-stack">
          {[
            { label: 'CONDITION', value: shortHash(ctx.selectedMarket?.conditionId || '', 10, 8) },
            { label: 'QUESTION', value: shortHash(ctx.selectedMarket?.questionId || '', 10, 8) },
            { label: 'YES TOKEN', value: shortHash(ctx.selectedMarket?.yesTokenId || '', 10, 8) },
            { label: 'NO TOKEN', value: shortHash(ctx.selectedMarket?.noTokenId || '', 10, 8) },
            { label: 'STATUS', value: ctx.selectedMarket?.status || '--' },
            { label: 'ORACLE', value: shortHash(ctx.selectedMarket?.oracle || '', 10, 8) },
          ].map((row) => (
            <article className="wm-detail-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </article>
          ))}
        </div>
      </Panel>
    ),
  },
  'price-implications': {
    render: (ctx) => (
      <Panel title="AI MARKET IMPLICATIONS" badge="LIVE" status="live">
        <div className="wm-implications-grid">
          {[
            { label: 'LATEST', value: formatPercent(ctx.bundle?.price?.latestPrice || ctx.bootstrap?.pricePreview?.latestPrice), tone: 'positive' },
            { label: '1H', value: formatPercent(ctx.bundle?.price?.change1h), tone: 'muted' },
            { label: '24H VOL', value: formatCompact(ctx.bundle?.price?.volume24h), tone: 'warning' },
            { label: '24H TRADES', value: String(ctx.bundle?.price?.tradeCount24h || 0), tone: 'muted' },
          ].map((row) => (
            <article className={`wm-implication-card ${row.tone}`} key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </article>
          ))}
        </div>
      </Panel>
    ),
  },
  'price-chart': {
    render: (ctx) => (
      <Panel title="PRICE SURFACE" badge="YES" status="live" count={ctx.bundle?.chart?.points.length || 0}>
        <div className="wm-price-surface">
          <div className="wm-price-surface-head">
            <article>
              <span>LAST</span>
              <strong>{formatPercent(ctx.bundle?.price?.latestPrice || ctx.bootstrap?.pricePreview?.latestPrice)}</strong>
            </article>
            <article>
              <span>1H</span>
              <strong>{formatPercent(ctx.bundle?.price?.change1h)}</strong>
            </article>
            <article>
              <span>24H TRADES</span>
              <strong>{String(ctx.bundle?.price?.tradeCount24h || 0)}</strong>
            </article>
          </div>
          {priceLine(ctx.bundle?.chart?.points || [])}
        </div>
      </Panel>
    ),
  },
};
