import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { MarketGroupItem, MarketGroupOutcome, MarketGroupSort, MarketListItem } from '@/types';
import type { PanelRenderMap } from './types';
import { formatCompact, formatCurrencyCompact, formatDate, formatPercent, formatRelative, formatSignedPercent, shortHash, signedClass } from './shared/formatters';
import { emptyState, priceLine } from './shared/renderers';
import { globalMarkets } from './shared/selectors';

const GENERIC_MARKET_TAGS = new Set([
  'all',
  'featured',
  'hide-from-new',
  'recurring',
  'onchain-registry',
  'up-or-down',
  'crypto-prices',
  '5m',
  '15m',
]);

function numericValue(value: string | number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDefaultSuppressedMarket(market: MarketListItem) {
  const tags = (market.tags || []).map((item) => String(item || '').trim().toLowerCase());
  const slug = String(market.slug || '').toLowerCase();
  const title = String(market.title || '').toLowerCase();
  const endAt = parseTimestamp(market.endDate);
  const price = numericValue(market.latestPrice);
  if (endAt && endAt < Date.now()) return true;
  if (price > 0 && (price < 0.1 || price > 0.9)) return true;
  if (tags.some((tag) => tag === 'hide-from-new' || tag === 'recurring' || tag === 'onchain-registry')) return true;
  if (slug.includes('updown-5m') || slug.includes('updown-15m')) return true;
  return title.includes(' up or down - ');
}

function marketTopic(market: MarketListItem) {
  const tags = (market.tags || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  const category = String(market.category || '').trim().toLowerCase();
  const title = `${market.title || ''} ${market.slug || ''}`.toLowerCase();
  if (category === 'crypto' || tags.includes('crypto') || tags.includes('crypto-prices')) return 'crypto';
  if (category === 'sports' || tags.includes('sports') || tags.includes('soccer') || tags.includes('games')) return 'sports';
  if (category.includes('politic') || tags.some((tag) => tag.includes('election') || tag.includes('politic'))) return 'politics';
  if (category.includes('economic') || category.includes('finance') || tags.some((tag) => ['fed', 'macro', 'economy', 'finance'].includes(tag))) return 'macro';
  if (category.includes('tech') || tags.some((tag) => ['ai', 'tech'].includes(tag))) return 'tech';
  const semanticTag = tags.find((tag) => !GENERIC_MARKET_TAGS.has(tag));
  if (semanticTag) return semanticTag;
  if (title.includes('bitcoin') || title.includes('ethereum') || title.includes('solana') || title.includes('xrp') || title.includes('dogecoin')) return 'crypto';
  return category || String(market.status || 'market').toLowerCase();
}

function groupTopic(group: MarketGroupItem) {
  const tags = (group.tags || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  const category = String(group.category || '').trim().toLowerCase();
  const title = `${group.title || ''} ${group.slug || ''}`.toLowerCase();
  if (category === 'crypto' || tags.includes('crypto') || tags.includes('crypto-prices')) return 'crypto';
  if (category === 'sports' || tags.includes('sports') || tags.includes('soccer') || tags.includes('games')) return 'sports';
  if (category.includes('politic') || tags.some((tag) => tag.includes('election') || tag.includes('politic'))) return 'politics';
  if (category.includes('economic') || category.includes('finance') || tags.some((tag) => ['fed', 'macro', 'economy', 'finance'].includes(tag))) return 'macro';
  if (category.includes('tech') || tags.some((tag) => ['ai', 'tech'].includes(tag))) return 'tech';
  const semanticTag = tags.find((tag) => !GENERIC_MARKET_TAGS.has(tag));
  if (semanticTag) return semanticTag;
  if (title.includes('bitcoin') || title.includes('ethereum') || title.includes('solana') || title.includes('xrp') || title.includes('dogecoin')) return 'crypto';
  return category || 'market';
}

function marketTiming(market: MarketListItem) {
  if (market.createdAt) return formatRelative(market.createdAt);
  if (market.lastTradeAt) return `${formatRelative(market.lastTradeAt)} trade`;
  if (market.endDate) return `closes ${formatRelative(market.endDate)}`;
  return '--';
}

function groupTiming(group: MarketGroupItem) {
  if (group.createdAt) return formatRelative(group.createdAt);
  if (group.endDate) return `closes ${formatRelative(group.endDate)}`;
  return '--';
}

function marketOutcomeLabel(market: MarketListItem) {
  const count = Number(market.outcomeCount || 0);
  if (count > 0) return `${count} outcomes`;
  return 'binary';
}

function groupOutcomeLabel(group: MarketGroupItem) {
  const count = Number(group.outcomeCount || group.outcomes?.length || 0);
  if (count > 0) return `${count} outcomes`;
  return 'event';
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

function groupAccent(group: MarketGroupItem) {
  const topic = groupTopic(group);
  if (topic.includes('crypto')) return '#f59e0b';
  if (topic.includes('sport')) return '#22c55e';
  if (topic.includes('politic') || topic.includes('election')) return '#60a5fa';
  if (topic.includes('finance') || topic.includes('fed') || topic.includes('macro')) return '#eab308';
  if (topic.includes('tech') || topic.includes('ai')) return '#a78bfa';
  return '#22c55e';
}

function diversifyByTopic<T>(items: T[], topicOf: (item: T) => string) {
  const buckets = new Map<string, T[]>();
  items.forEach((item) => {
    const topic = topicOf(item) || 'market';
    const bucket = buckets.get(topic) || [];
    bucket.push(item);
    buckets.set(topic, bucket);
  });
  const topics = Array.from(buckets.keys()).sort((a, b) => {
    const sizeDelta = (buckets.get(b)?.length || 0) - (buckets.get(a)?.length || 0);
    return sizeDelta || a.localeCompare(b);
  });
  const diversified: T[] = [];
  while (diversified.length < items.length && topics.length) {
    for (const topic of topics) {
      const next = buckets.get(topic)?.shift();
      if (next) diversified.push(next);
    }
    for (let index = topics.length - 1; index >= 0; index -= 1) {
      const topic = topics[index];
      if (!topic || !(buckets.get(topic) || []).length) topics.splice(index, 1);
    }
  }
  return diversified;
}

function defaultGroupMarketId(group: MarketGroupItem) {
  if (group.defaultMarketId) return group.defaultMarketId;
  const topWithMarket = (group.topOutcomes || []).find((outcome) => outcome.marketId);
  if (topWithMarket?.marketId) return Number(topWithMarket.marketId);
  const firstWithMarket = (group.outcomes || []).find((outcome) => outcome.marketId);
  return firstWithMarket?.marketId ? Number(firstWithMarket.marketId) : null;
}

function groupOutcomePills(outcomes: MarketGroupOutcome[]) {
  const visible = outcomes.slice(0, 2);
  const remaining = Math.max(0, outcomes.length - visible.length);
  if (!visible.length) return <span className="wm-poly-market-outcome">Pending outcomes</span>;
  return (
    <>
      {visible.map((outcome) => (
        <span
          className="wm-poly-market-outcome"
          key={`${outcome.marketId || outcome.gammaMarketId || outcome.label}`}
          title={outcome.label || 'Outcome'}
        >
          {outcome.label || 'Outcome'} <b>{formatPercent(outcome.yesPrice)}</b>
        </span>
      ))}
      {remaining ? <span className="wm-poly-market-more">+{remaining}</span> : null}
    </>
  );
}

function activeMarketGroupsList(
  groups: MarketGroupItem[],
  selectedMarketId: number | null,
  selectedMarketGroupId: string | null,
  focusMarketGroup: (group: MarketGroupItem, outcomeKey?: string | null, marketId?: number | null) => void,
) {
  if (!groups.length) return emptyState('No active market groups yet.');
  return (
    <div className="wm-poly-market-list">
      {groups.map((group) => {
        const defaultMarketId = defaultGroupMarketId(group);
        const groupEventId = group.eventId != null ? String(group.eventId) : null;
        const selected = (groupEventId != null && selectedMarketGroupId === groupEventId) || (defaultMarketId != null && selectedMarketId === defaultMarketId);
        return (
          <button
            key={group.groupId}
            type="button"
            className={`wm-poly-market-card ${selected ? 'active' : ''}`}
            onClick={() => {
              focusMarketGroup(group, group.defaultOutcomeKey || null, defaultMarketId);
            }}
            aria-pressed={selected}
            title={group.title}
            style={{ borderLeftColor: groupAccent(group) }}
          >
            <div className="wm-poly-market-card-main">
              <div className="wm-poly-market-meta">
                <span className="wm-poly-market-dot" />
                <span>{groupTopic(group)}</span>
                <span>·</span>
                <span>{groupTiming(group)}</span>
                <span>·</span>
                <span>{groupOutcomeLabel(group)}</span>
              </div>
              <strong className="wm-poly-market-title">{group.title}</strong>
              <div className="wm-poly-market-bottom">
                {groupOutcomePills(group.topOutcomes || group.outcomes || [])}
                <span className="wm-poly-market-volume">vol {formatCurrencyCompact(group.volume24h)} 24h</span>
              </div>
            </div>
            <span className="wm-poly-market-star" aria-hidden="true">☆</span>
          </button>
        );
      })}
    </div>
  );
}

function activeMarketsList(markets: MarketListItem[], selectedMarketId: number | null, setSelectedMarketId: (marketId: number | null) => void) {
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

function ActiveMarketsPanel({
  markets,
  marketGroups,
  marketGroupSort,
  setMarketGroupSort,
  selectedMarketId,
  selectedMarketGroupId,
  setSelectedMarketId,
  focusMarketGroup,
}: {
  markets: MarketListItem[];
  marketGroups: MarketGroupItem[];
  marketGroupSort: MarketGroupSort;
  setMarketGroupSort: (sort: MarketGroupSort) => void;
  selectedMarketId: number | null;
  selectedMarketGroupId: string | null;
  setSelectedMarketId: (marketId: number | null) => void;
  focusMarketGroup: (group: MarketGroupItem, outcomeKey?: string | null, marketId?: number | null) => void;
}) {
  const [search, setSearch] = useState('');

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? marketGroups.filter((group) => {
          const haystack = [
            group.title,
            group.slug,
            group.category,
            ...(group.tags || []),
            ...(group.outcomes || []).map((outcome) => outcome.label || outcome.title || ''),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        })
      : [...marketGroups];
    if (marketGroupSort === 'new') {
      return filtered.sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt));
    }
    if (marketGroupSort === 'volume') {
      return filtered.sort((a, b) => Number(b.volume24h || 0) - Number(a.volume24h || 0));
    }
    return query ? filtered : diversifyByTopic(filtered, groupTopic);
  }, [marketGroupSort, marketGroups, search]);

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
      : markets.filter((market) => !isDefaultSuppressedMarket(market));
    const ranked = filtered.sort((a, b) => Number(b.volume24h || 0) - Number(a.volume24h || 0));
    return query ? ranked : diversifyByTopic(ranked, marketTopic);
  }, [markets, search]);

  const hasGroups = marketGroups.length > 0;
  const panelCount = hasGroups ? visibleGroups.length : visibleMarkets.length;

  return (
    <Panel
      title="MARKETS"
      badge="LIVE"
      status="live"
      count={panelCount}
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
            value={marketGroupSort}
            onInput={(event) => setMarketGroupSort(event.currentTarget.value as MarketGroupSort)}
            aria-label="Sort markets"
          >
            <option value="active">Active</option>
            <option value="new">Newest</option>
            <option value="volume">Volume</option>
          </select>
        </div>
      }
    >
      {hasGroups
        ? activeMarketGroupsList(visibleGroups, selectedMarketId, selectedMarketGroupId, focusMarketGroup)
        : activeMarketsList(visibleMarkets, selectedMarketId, setSelectedMarketId)}
    </Panel>
  );
}


export const marketPanelRenderers: PanelRenderMap = {
  'active-markets': {
    render: (ctx) => (
      <ActiveMarketsPanel
        markets={globalMarkets(ctx)}
        marketGroups={ctx.marketGroups}
        marketGroupSort={ctx.marketGroupSort}
        setMarketGroupSort={ctx.setMarketGroupSort}
        selectedMarketId={ctx.selectedMarketId}
        selectedMarketGroupId={ctx.selectedMarketGroupId}
        setSelectedMarketId={ctx.setSelectedMarketId}
        focusMarketGroup={ctx.focusMarketGroup}
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
