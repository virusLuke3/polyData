import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { MarketListItem } from '@/types';
import type { PanelRenderMap } from './types';
import { formatCompact, formatCurrencyCompact, formatDate, formatPercent, formatRelative, formatSignedPercent, shortHash, signedClass } from './shared/formatters';
import { emptyState, priceLine, summaryRows } from './shared/renderers';
import { globalMarkets } from './shared/selectors';

function marketTopic(market: MarketListItem) {
  const tag = market.tags?.find((item) => String(item || '').trim());
  return String(tag || market.category || market.status || 'market').toLowerCase();
}

function marketTiming(market: MarketListItem) {
  if (market.endDate) return formatRelative(market.endDate);
  if (market.lastTradeAt) return `${formatRelative(market.lastTradeAt)} trade`;
  if (market.createdAt) return `${formatRelative(market.createdAt)} old`;
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

function activeMarketsList(markets: MarketListItem[], selectedMarketId: number | null, setSelectedMarketId: (marketId: number) => void) {
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

type ActiveMarketSort = 'impact' | 'volume' | 'new';

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

    if (sortOrder === 'volume') {
      return filtered.sort(
        (a, b) =>
          Number(b.volume24h || 0) - Number(a.volume24h || 0) ||
          Number(b.tradeCount24h || 0) - Number(a.tradeCount24h || 0) ||
          new Date(b.lastTradeAt || 0).getTime() - new Date(a.lastTradeAt || 0).getTime()
      );
    }
    if (sortOrder === 'new') {
      return filtered.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    return filtered;
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
        {summaryRows([
          { label: 'MARKET', value: ctx.selectedMarket?.title || '--' },
          { label: 'CATEGORY', value: ctx.selectedMarket?.category || '--' },
          { label: 'PRICE', value: formatPercent(ctx.bundle?.price?.latestPrice || ctx.bootstrap?.pricePreview?.latestPrice) },
          { label: 'END', value: formatDate(ctx.selectedMarket?.endDate || null) },
        ])}
      </Panel>
    ),
  },
  'market-summary': {
    render: (ctx) => (
      <Panel title="MARKET SUMMARY" badge="MARKET" status="live">
        {summaryRows([
          { label: 'CONDITION', value: shortHash(ctx.selectedMarket?.conditionId || '', 10, 8) },
          { label: 'QUESTION', value: shortHash(ctx.selectedMarket?.questionId || '', 10, 8) },
          { label: 'YES TOKEN', value: shortHash(ctx.selectedMarket?.yesTokenId || '', 10, 8) },
          { label: 'NO TOKEN', value: shortHash(ctx.selectedMarket?.noTokenId || '', 10, 8) },
          { label: 'STATUS', value: ctx.selectedMarket?.status || '--' },
          { label: 'ORACLE', value: shortHash(ctx.selectedMarket?.oracle || '', 10, 8) },
        ])}
      </Panel>
    ),
  },
  'price-implications': {
    render: (ctx) => (
      <Panel title="AI MARKET IMPLICATIONS" badge="LIVE" status="live">
        {summaryRows([
          { label: 'LATEST', value: formatPercent(ctx.bundle?.price?.latestPrice || ctx.bootstrap?.pricePreview?.latestPrice) },
          { label: '1H', value: formatPercent(ctx.bundle?.price?.change1h) },
          { label: '24H VOL', value: formatCompact(ctx.bundle?.price?.volume24h) },
          { label: '24H TRADES', value: String(ctx.bundle?.price?.tradeCount24h || 0) },
        ])}
      </Panel>
    ),
  },
  'price-chart': {
    render: (ctx) => (
      <Panel title="PRICE SURFACE" badge="YES" status="live" count={ctx.bundle?.chart?.points.length || 0}>
        {priceLine(ctx.bundle?.chart?.points || [])}
      </Panel>
    ),
  },
};

