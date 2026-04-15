import type { VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type {
  ChartPoint,
  ContentItem,
  MarketListItem,
  OracleEvent,
  PanelDefinition,
  PanelRenderContext,
  RuntimeMarketTicker,
  RuntimeTradeSignal,
  TradeRow,
} from '@/types';

function formatPercent(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatCompact(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
}

function formatCurrencyCompact(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '--';
  return `$${formatCompact(value)}`;
}

function formatSignedPercent(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${(numeric * 100).toFixed(1)}%`;
}

function signedClass(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return 'flat';
  return numeric > 0 ? 'up' : 'down';
}

function formatDate(value?: string | null) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(value?: string | null) {
  if (!value) return '--';
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return '--';
  const diffMs = time - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const suffix = diffMs >= 0 ? '' : ' ago';
  if (absMs < hour) return `${Math.max(1, Math.round(absMs / minute))}m${suffix}`;
  if (absMs < day) return `${Math.round(absMs / hour)}h${suffix}`;
  return `${Math.round(absMs / day)}d${suffix}`;
}

function shortHash(value?: string | null, leading = 10, trailing = 6) {
  if (!value) return '--';
  if (trailing <= 0) {
    return value.length <= leading ? value : `${value.slice(0, leading)}...`;
  }
  if (value.length <= leading + trailing + 3) return value;
  return `${value.slice(0, leading)}...${value.slice(-trailing)}`;
}

function emptyState(message: string) {
  return <div className="wm-empty">{message}</div>;
}

function priceLine(points: ChartPoint[]) {
  const clean = points
    .map((point, index) => ({ index, value: Number(point.yesPrice) }))
    .filter((point) => Number.isFinite(point.value));

  if (clean.length < 2) return emptyState('No price history loaded yet.');

  const width = 520;
  const height = 160;
  const min = Math.min(...clean.map((point) => point.value));
  const max = Math.max(...clean.map((point) => point.value));
  const span = max - min || 1;
  const path = clean
    .map((point, idx) => {
      const x = (point.index / Math.max(clean.length - 1, 1)) * width;
      const y = height - ((point.value - min) / span) * height;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className="wm-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="wm-line-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wmPriceLine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff5555" />
            <stop offset="60%" stopColor="#ff8c37" />
            <stop offset="100%" stopColor="#ffcf4b" />
          </linearGradient>
          <linearGradient id="wmPriceArea" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255, 168, 42, 0.42)" />
            <stop offset="100%" stopColor="rgba(255, 168, 42, 0.03)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#wmPriceArea)" />
        <path d={path} fill="none" stroke="url(#wmPriceLine)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="wm-line-axis">
        <span>{formatPercent(min)}</span>
        <span>{formatPercent(max)}</span>
      </div>
    </div>
  );
}

function sparkline(points: Array<{ value?: number | null }>, color = '#39ff73') {
  const clean = points
    .map((point, index) => ({ index, value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.value));
  if (clean.length < 2) return null;
  const width = 140;
  const height = 40;
  const min = Math.min(...clean.map((point) => point.value));
  const max = Math.max(...clean.map((point) => point.value));
  const span = max - min || 1;
  const path = clean
    .map((point, idx) => {
      const x = (point.index / Math.max(clean.length - 1, 1)) * width;
      const y = height - ((point.value - min) / span) * height;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="wm-mini-spark" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

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

function tradeList(trades: TradeRow[], limit = 8) {
  if (!trades.length) return emptyState('Waiting for trade rows.');
  return (
    <div className="wm-panel-list">
      {trades.slice(0, limit).map((trade) => (
        <article className="wm-trade-card" key={`${trade.txHash}-${trade.logIndex}`}>
          <div className="wm-trade-header">
            <span className={`wm-chip ${String(trade.side).toLowerCase() === 'buy' ? 'positive' : 'critical'}`}>
              {trade.side || 'UNKNOWN'}
            </span>
            <span className="wm-dim">{trade.outcome || '--'}</span>
          </div>
          <div className="wm-trade-price">{formatPercent(trade.price)}</div>
          <div className="wm-trade-market">{trade.marketTitle || `Market #${trade.marketId || '--'}`}</div>
          <div className="wm-trade-meta">
            <span>{shortHash(trade.txHash)}</span>
            <span>{formatDate(trade.timestamp || null)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function oracleList(events: OracleEvent[], limit = 8) {
  if (!events.length) return emptyState('No oracle activity loaded.');
  return (
    <div className="wm-panel-list">
      {events.slice(0, limit).map((event, index) => (
        <article className="wm-oracle-card" key={`${event.id || index}-${event.blockNumber || index}`}>
          <div className="wm-oracle-header">
            <strong>{event.marketTitle || event.eventStatus || 'Oracle event'}</strong>
            <span>{event.eventStatus || 'event'}</span>
          </div>
          <div className="wm-oracle-meta">
            <span>{formatDate(event.eventTime || null)}</span>
            <span>{shortHash(event.questionId || event.conditionId || '', 8, 5)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function contentList(items: ContentItem[], emptyMessage: string) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-panel-list">
      {items.slice(0, 6).map((item, index) => (
        <a className="wm-news-card" href={item.url || '#'} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}>
          <div className="wm-news-source">{item.source || item.contentType || 'intel'}</div>
          <div className="wm-news-title">{item.title || 'Untitled item'}</div>
          <div className="wm-news-meta">{formatDate(item.publishedAt || null)}</div>
        </a>
      ))}
    </div>
  );
}

function inferContentType(item: ContentItem) {
  const explicit = String(item.contentType || '').trim().toLowerCase();
  if (explicit) return explicit;
  const haystack = `${item.title || ''} ${item.source || ''} ${item.url || ''}`.toLowerCase();
  if (/youtube|youtu\.be|vimeo|video|livestream|stream/.test(haystack)) return 'video';
  if (/report|brief|dossier|outlook|filing/.test(haystack)) return 'report';
  if (/research|analysis|paper|study|forecast/.test(haystack)) return 'research';
  return 'news';
}

function contentByType(items: ContentItem[], contentType: string) {
  return items.filter((item) => inferContentType(item) === contentType);
}

function summaryRows(rows: Array<{ label: string; value: string }>) {
  return (
    <div className="wm-summary-grid">
      {rows.map((row) => (
        <div className="wm-summary-row" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function marketTickerGrid(items: RuntimeMarketTicker[], emptyMessage: string) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-market-grid">
      {items.map((item) => (
        <article className="wm-market-ticker-card" key={item.symbol}>
          <div className="wm-market-ticker-top">
            <span>{item.label}</span>
            <strong>{item.price == null ? '--' : Number(item.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong>
          </div>
          <div className="wm-market-spark-wrap">{sparkline(item.points || [], (item.changePercent || 0) >= 0 ? '#39ff73' : '#ff6464')}</div>
          <div className={`wm-market-change ${(item.changePercent || 0) >= 0 ? 'up' : 'down'}`}>
            {item.changePercent == null ? '--' : `${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`}
          </div>
        </article>
      ))}
    </div>
  );
}

function marketTickerList(items: RuntimeMarketTicker[], emptyMessage: string) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-ticker-list">
      {items.map((item) => {
        const isUp = (item.changePercent || 0) >= 0;
        return (
          <article className="wm-ticker-row" key={item.symbol}>
            <div className="wm-ticker-meta">
              <strong>{item.label}</strong>
              <span>{item.symbol}</span>
            </div>
            <div className="wm-ticker-spark">
              {sparkline(item.points || [], isUp ? '#39ff73' : '#ff6464')}
            </div>
            <div className="wm-ticker-value">
              <strong>{item.price == null ? '--' : Number(item.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong>
              <span className={isUp ? 'up' : 'down'}>
                {item.changePercent == null ? '--' : `${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function signalMetric(value?: string | number | null, formatter: (value?: string | number | null) => string = String) {
  if (value === null || value === undefined || value === '') return '--';
  return formatter(value);
}

function signalBias(item: RuntimeTradeSignal) {
  const explicit = String(item.bias || '').toLowerCase();
  if (explicit === 'bearish' || explicit === 'bullish') return explicit;
  return String(item.side || '').toUpperCase() === 'SELL' ? 'bearish' : 'bullish';
}

function signalAction(item: RuntimeTradeSignal) {
  const side = item.action?.label || (String(item.side || '').toUpperCase() === 'SELL' ? 'Sell' : 'Buy');
  const outcome = item.action?.outcome || (String(item.outcome || '').toUpperCase() === 'NO' ? 'No' : 'Yes');
  return { side, outcome };
}

function alphaSignalList(items: RuntimeTradeSignal[], emptyMessage: string, onMarketSelect?: (marketId: number) => void) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-signal-list">
      {items.map((item, index) => {
        const severity = item.severity === 'critical' ? 'critical' : item.severity === 'elevated' ? 'elevated' : 'watch';
        const metrics = item.metrics || null;
        const bias = signalBias(item);
        const action = signalAction(item);
        const hasPolybeatsShape = Boolean(metrics || item.addresses?.length || item.relatedContent?.length);
        return (
          <article
            className={`wm-signal-card ${severity} ${hasPolybeatsShape ? 'polybeats' : ''} ${bias}`}
            key={`${item.title || item.marketTitle || 'signal'}-${index}`}
          >
            <div className="wm-signal-content">
              <div className="wm-signal-topline">
                <div className="wm-signal-source">
                  <span className="wm-signal-icon">N</span>
                  <strong>{item.sourceLabel || (item.relatedContent?.length ? 'NEWS+$' : 'CHAIN+$')}</strong>
                  <em className={bias}>{bias}</em>
                </div>
                {!!item.timestamp && <span className="wm-signal-age">{formatRelative(item.timestamp)}</span>}
              </div>

              <div className="wm-signal-copy-row">
                <span className="wm-signal-source-tag">{item.sourceTag || 'SIG'}</span>
                <p className="wm-signal-copy">
                  {item.headline || item.title || item.summary || 'Signal activity detected'}
                </p>
              </div>

              <button
                className="wm-signal-market-strip"
                type="button"
                onClick={() => item.marketId && onMarketSelect?.(item.marketId)}
                disabled={!item.marketId || !onMarketSelect}
                title={item.marketTitle || item.title || 'Open market'}
              >
                <span>{bias === 'bearish' ? 'v' : '^'}</span>
                <strong>{item.marketTitle || item.title || 'Market signal'}</strong>
              </button>

              <div className="wm-signal-bottom">
                <div className="wm-signal-stat"><strong>${formatCompact(metrics?.totalNotional || item.notional)}</strong><span>vol</span></div>
                <div className="wm-signal-stat"><strong>{signalMetric(metrics?.tradeCount)}</strong><span>trades</span></div>
                <div className="wm-signal-stat"><strong>{signalMetric(metrics?.accountCount || item.addresses?.length)}</strong><span>wallet(s)</span></div>
                <div className="wm-signal-stat"><strong>@{formatPercent(metrics?.currentProbability || metrics?.avgPrice || item.price)}</strong><span>prob</span></div>
                <button className="wm-signal-action" type="button" onClick={() => item.marketId && onMarketSelect?.(item.marketId)} disabled={!item.marketId || !onMarketSelect}>
                  <strong>{action.side}</strong>
                  <span>{action.outcome}</span>
                </button>
              </div>

              {!!item.addresses?.length && (
                <div className="wm-signal-addresses">
                  {item.addresses.slice(0, 4).map((address) => (
                    <div className="wm-signal-address" key={address.address || address.shortAddress || `${item.title}-${index}`}>
                      <strong>{address.shortAddress || shortHash(address.address, 6, 4)}</strong>
                      <span>{(address.labels || []).slice(0, 2).join(' / ') || 'tracked'}</span>
                    </div>
                  ))}
                </div>
              )}
              {!!item.contributors?.length && (
                <div className="wm-signal-contributors">
                  {item.contributors.slice(0, 4).map((contributor: string) => (
                    <span className="wm-signal-contributor" key={`${item.title || index}-${contributor}`}>
                      {String(contributor).toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function tradeSignalList(items: RuntimeTradeSignal[], emptyMessage: string) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-signal-list">
      {items.map((item, index) => {
        const severity = String(item.severity || 'watch').toLowerCase();
        const side = String(item.side || '--').toUpperCase();
        const outcome = String(item.outcome || '--').toUpperCase();
        return (
          <article className={`wm-trade-signal-card ${severity}`} key={`${item.txHash || item.title || 'trade'}-${index}`}>
            <div className="wm-trade-signal-rail" />
            <div className="wm-trade-signal-content">
              <div className="wm-trade-signal-head">
                <div className="wm-trade-chip-row">
                  <span className={`wm-chip ${side === 'BUY' ? 'positive' : side === 'SELL' ? 'critical' : ''}`}>{side}</span>
                  <span className="wm-trade-outcome">{outcome}</span>
                </div>
                <span className={`wm-signal-severity ${severity}`}>{severity.toUpperCase()}</span>
              </div>
              <div className="wm-trade-signal-body">
                <strong className="wm-trade-signal-notional">{formatPercent(item.price)}</strong>
                <span className="wm-trade-signal-market">{item.marketTitle || 'Market signal'}</span>
              </div>
              <div className="wm-trade-signal-meta">
                <span>{shortHash(item.txHash || '', 12, 6)}</span>
                <span>{item.notional ? `$${formatCompact(item.notional)}` : '--'}</span>
                <span>{formatDate(item.timestamp || null)}</span>
              </div>
              {item.summary ? <div className="wm-trade-signal-summary">{item.summary}</div> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function nbaIntelPanel(ctx: PanelRenderContext) {
  const intel = ctx.nbaIntel;
  if (!intel || (!intel.items.length && !intel.lineups.length)) {
    return emptyState('No NBA intel loaded.');
  }
  return (
    <div className="wm-panel-stack">
      {!!intel.lineups.length && (
        <section className="wm-subpanel">
          <div className="wm-subpanel-title">LINEUPS</div>
          <div className="wm-panel-list">
            {intel.lineups.slice(0, 3).map((game, index) => (
              <article className="wm-lineup-card" key={`${game.gameId || game.label}-${index}`}>
                <div className="wm-lineup-head">
                  <strong>{game.label || 'NBA matchup'}</strong>
                  <span>{game.status || '--'}</span>
                </div>
                <div className="wm-lineup-columns">
                  {['HOME', 'AWAY'].map((side) => (
                    <div className="wm-lineup-team" key={side}>
                      <div className="wm-lineup-team-label">{side}</div>
                      <div className="wm-lineup-players">
                        {(game.starters || []).filter((player) => player.side === side).slice(0, 5).map((player, playerIndex) => (
                          <div className="wm-lineup-player" key={`${side}-${player.playerName}-${playerIndex}`}>
                            <span>{player.playerName || '--'}</span>
                            <em>{player.position || player.lineupStatus || ''}</em>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!!intel.items.length && (
        <section className="wm-subpanel">
          <div className="wm-subpanel-title">ESPN / BEAT INTEL</div>
          <div className="wm-panel-list">
            {intel.items.slice(0, 8).map((item, index) => (
              <a className="wm-news-card" href={item.url || '#'} target="_blank" rel="noreferrer" key={`${item.url || item.headline}-${index}`}>
                <div className="wm-news-source">{item.source || 'ESPN'}</div>
                <div className="wm-news-title">{item.headline || 'NBA intel item'}</div>
                <div className="wm-news-meta">{formatDate(item.publishedAt || null)}</div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function inflationNowcastPanel(ctx: PanelRenderContext) {
  const nowcast = ctx.inflationNowcast;
  if (!nowcast) return emptyState('No inflation nowcast loaded.');
  const mom = nowcast.monthOverMonth || {};
  const yoy = nowcast.yearOverYear || {};
  const monthlyLabel = mom['Month'] || yoy['Month'] || '--';
  return (
    <div className="wm-panel-stack">
      <section className="wm-nowcast-grid">
        {[
          { label: 'MONTH', value: monthlyLabel },
          { label: 'CPI MOM', value: mom['CPI'] || '--' },
          { label: 'CORE CPI', value: mom['Core CPI'] || '--' },
          { label: 'PCE MOM', value: mom['PCE'] || '--' },
          { label: 'CPI YOY', value: yoy['CPI'] || '--' },
          { label: 'CORE PCE', value: yoy['Core PCE'] || '--' },
        ].map((row) => (
          <article className="wm-nowcast-card" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </article>
        ))}
      </section>
      {!!nowcast.quarterly?.length && (
        <section className="wm-subpanel">
          <div className="wm-subpanel-title">QUARTERLY ANNUALIZED</div>
          <div className="wm-panel-list">
            {nowcast.quarterly.slice(0, 3).map((row, index) => (
              <article className="wm-oracle-card" key={`${row['Quarter'] || row['Quarter '] || row['Date'] || index}`}>
                <div className="wm-oracle-header">
                  <strong>{row['Quarter'] || row['Date'] || `Q${index + 1}`}</strong>
                  <span>{row['Updated'] || row['Updated '] || 'fed'}</span>
                </div>
                <div className="wm-summary-grid">
                  <div className="wm-summary-row"><span>CPI</span><strong>{row['CPI'] || '--'}</strong></div>
                  <div className="wm-summary-row"><span>CORE CPI</span><strong>{row['Core CPI'] || '--'}</strong></div>
                  <div className="wm-summary-row"><span>PCE</span><strong>{row['PCE'] || '--'}</strong></div>
                  <div className="wm-summary-row"><span>CORE PCE</span><strong>{row['Core PCE'] || '--'}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function nbaGames(items: NonNullable<PanelRenderContext['nba']>['items']) {
  if (!items.length) return emptyState('No NBA games loaded.');
  return (
    <div className="wm-panel-list">
      {items.map((game) => (
        <article className="wm-oracle-card" key={game.id || game.name}>
          <div className="wm-oracle-header">
            <strong>{game.awayTeam} @ {game.homeTeam}</strong>
            <span>{game.state || 'pre'}</span>
          </div>
          <div className="wm-summary-grid">
            <div className="wm-summary-row"><span>TIP</span><strong>{formatDate(game.tipoff || null)}</strong></div>
            <div className="wm-summary-row"><span>SCORE</span><strong>{`${game.awayScore ?? '-'} - ${game.homeScore ?? '-'}`}</strong></div>
          </div>
          <div className="wm-news-meta">{game.status || game.broadcast || '--'}</div>
        </article>
      ))}
    </div>
  );
}

function lobPanel(ctx: PanelRenderContext, showDepth: boolean) {
  const lob = ctx.bundle?.lob;
  if (!lob) return emptyState('LOB runtime unavailable for the selected market.');
  if (!showDepth) {
    return (
      <div className="wm-summary-grid">
        <div className="wm-summary-row"><span>YES BBO</span><strong>{formatPercent(lob.yes?.bestBid)} / {formatPercent(lob.yes?.bestAsk)}</strong></div>
        <div className="wm-summary-row"><span>YES SPR</span><strong>{formatPercent(lob.yes?.spread)}</strong></div>
        <div className="wm-summary-row"><span>NO BBO</span><strong>{formatPercent(lob.no?.bestBid)} / {formatPercent(lob.no?.bestAsk)}</strong></div>
        <div className="wm-summary-row"><span>NO SPR</span><strong>{formatPercent(lob.no?.spread)}</strong></div>
      </div>
    );
  }
  return (
    <div className="wm-lob-layout">
      <div className="wm-lob-side-card">
        <div className="wm-lob-head">
          <span>YES BOOK</span>
          <strong>{formatPercent(lob.yes?.bestBid)} / {formatPercent(lob.yes?.bestAsk)}</strong>
        </div>
        <div className="wm-depth-list">
          {[...(lob.yes?.bids || []).slice(0, 4), ...(lob.yes?.asks || []).slice(0, 4)].map((level, index) => (
            <div className={`wm-depth-row ${index >= (lob.yes?.bids || []).slice(0, 4).length ? 'ask' : ''}`} key={`yes-${index}`}>
              <span>{index >= (lob.yes?.bids || []).slice(0, 4).length ? 'ASK' : 'BID'}</span>
              <strong>{formatPercent(level.price)}</strong>
              <em>{formatCompact(level.size)}</em>
            </div>
          ))}
        </div>
      </div>
      <div className="wm-lob-side-card">
        <div className="wm-lob-head">
          <span>NO BOOK</span>
          <strong>{formatPercent(lob.no?.bestBid)} / {formatPercent(lob.no?.bestAsk)}</strong>
        </div>
        <div className="wm-depth-list">
          {[...(lob.no?.bids || []).slice(0, 4), ...(lob.no?.asks || []).slice(0, 4)].map((level, index) => (
            <div className={`wm-depth-row ${index >= (lob.no?.bids || []).slice(0, 4).length ? 'ask' : ''}`} key={`no-${index}`}>
              <span>{index >= (lob.no?.bids || []).slice(0, 4).length ? 'ASK' : 'BID'}</span>
              <strong>{formatPercent(level.price)}</strong>
              <em>{formatCompact(level.size)}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function focusedTrades(ctx: PanelRenderContext) {
  return ctx.bundle?.trades?.length
    ? ctx.bundle.trades
    : (ctx.bootstrap?.featuredMarket?.id === ctx.selectedMarketId ? ctx.bootstrap.recentTradesPreview : []);
}

function focusedOracle(ctx: PanelRenderContext) {
  return ctx.bundle?.oracle?.timeline?.length
    ? ctx.bundle.oracle.timeline
    : (ctx.bootstrap?.featuredMarket?.id === ctx.selectedMarketId ? ctx.bootstrap.oraclePreview : []);
}

function focusedContent(ctx: PanelRenderContext) {
  return ctx.bundle?.content?.items?.length
    ? ctx.bundle.content.items
    : (ctx.bootstrap?.featuredMarket?.id === ctx.selectedMarketId ? ctx.bootstrap.contentPreview : ctx.latestContent);
}

function globalMarkets(ctx: PanelRenderContext) {
  return ctx.markets.length ? ctx.markets : (ctx.bootstrap?.activeMarketsPreview || []);
}

function globalOracle(ctx: PanelRenderContext) {
  return ctx.globalOracle.length ? ctx.globalOracle : (ctx.bootstrap?.globalOraclePreview || []);
}

function fallbackContent(items: ContentItem[], contentType: string) {
  const filtered = contentByType(items, contentType);
  if (filtered.length) return filtered;
  return items.slice(0, 4);
}

export const PANEL_LIBRARY: PanelDefinition[] = [
  { id: 'world-brief', title: 'World Brief', eyebrow: 'context', description: 'Selected market narrative and context.' },
  { id: 'active-markets', title: 'Active Markets', eyebrow: 'market', description: 'Live active market list.' },
  { id: 'global-orderfilled', title: 'Orderfilled Flow', eyebrow: 'chain', description: 'Cross-market latest on-chain trades.' },
  { id: 'oracle-feed', title: 'Oracle Feed', eyebrow: 'oracle', description: 'Recent oracle events across markets.' },
  { id: 'featured-market', title: 'Featured Market', eyebrow: 'focus', description: 'Primary market card with key stats.' },
  { id: 'market-summary', title: 'Market Summary', eyebrow: 'market', description: 'Identifiers, category, timing, and pricing.' },
  { id: 'price-implications', title: 'Price Implications', eyebrow: 'price', description: 'Latest price and derived trade stats.' },
  { id: 'price-chart', title: 'Price Surface', eyebrow: 'price', description: 'Focused market probability curve.', size: 'wide' },
  { id: 'sample-chain-trades', title: 'Market Tape', eyebrow: 'chain', description: 'Focused market trade tape.' },
  { id: 'oracle-timeline', title: 'Oracle Timeline', eyebrow: 'oracle', description: 'Focused market oracle timeline.' },
  { id: 'bbo-monitor', title: 'BBO Monitor', eyebrow: 'lob', description: 'Runtime best bid/ask snapshot.' },
  { id: 'lob-depth', title: 'LOB Depth', eyebrow: 'lob', description: 'Focused market book depth.', size: 'wide' },
  { id: 'related-news', title: 'Related News', eyebrow: 'intel', description: 'News linked to focused market.' },
  { id: 'related-video', title: 'Video Feed', eyebrow: 'content', description: 'Video content linked to market.' },
  { id: 'report-feed', title: 'Report Feed', eyebrow: 'content', description: 'Long-form reports and writeups.' },
  { id: 'research-feed', title: 'Research Feed', eyebrow: 'content', description: 'Research and analysis artifacts.' },
  { id: 'live-api-status', title: 'Live API Status', eyebrow: 'system', description: 'Runtime health and sync status.' },
  { id: 'system-health', title: 'System Health', eyebrow: 'system', description: 'Infra and sync readiness.' },
  { id: 'commodities-watch', title: 'Commodities Watch', eyebrow: 'macro', description: 'Commodity price boards and sparklines.' },
  { id: 'crypto-watch', title: 'Crypto Watch', eyebrow: 'macro', description: 'Crypto spot trends and sparklines.' },
  { id: 'nba-scoreboard', title: 'NBA Scoreboard', eyebrow: 'sports', description: 'Upcoming and live NBA games.' },
  { id: 'nba-intel', title: 'NBA Intel', eyebrow: 'sports', description: 'ESPN news, starting lineups, and pregame rumors.' },
  { id: 'inflation-nowcast', title: 'Inflation Nowcast', eyebrow: 'macro', description: 'Cleveland Fed CPI/PCE nowcasting panel.' },
  { id: 'alpha-signal', title: 'Alpha Signal', eyebrow: 'signal', description: 'Cross-source heuristic signal stack.' },
  { id: 'whale-tracker', title: 'Whale Tracker', eyebrow: 'chain', description: 'Largest recent on-chain trades.' },
  { id: 'suspicious-flow', title: 'Suspicious Flow', eyebrow: 'chain', description: 'Pre-oracle or unusual trade flow.' },
];

type RegistryEntry = PanelDefinition & {
  render: (ctx: PanelRenderContext) => VNode;
};

export const PANEL_REGISTRY: Record<string, RegistryEntry> = {
  'world-brief': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'world-brief')!,
    render: (ctx) => (
      <Panel title="WORLD BRIEF" badge="LIVE" status="live">
        <div className="wm-brief-card">
          <div className="wm-brief-label">FEATURED CONTEXT</div>
          <div className="wm-brief-copy">
            {ctx.selectedMarket?.description || 'Select a live market to inspect chain activity, oracle state, runtime LOB, and linked intelligence.'}
          </div>
        </div>
      </Panel>
    ),
  },
  'active-markets': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'active-markets')!,
    render: (ctx) => (
      <ActiveMarketsPanel
        markets={globalMarkets(ctx)}
        selectedMarketId={ctx.selectedMarketId}
        setSelectedMarketId={ctx.setSelectedMarketId}
      />
    ),
  },
  'global-orderfilled': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'global-orderfilled')!,
    render: (ctx) => (
      <Panel title="ORDERFILLED FLOW" badge="FOCUSED" status="live" count={focusedTrades(ctx).length}>
        {tradeList(focusedTrades(ctx), 10)}
      </Panel>
    ),
  },
  'oracle-feed': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'oracle-feed')!,
    render: (ctx) => (
      <Panel title="ORACLE FEED" badge="LIVE" status="live" count={globalOracle(ctx).length}>
        {oracleList(globalOracle(ctx), 10)}
      </Panel>
    ),
  },
  'featured-market': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'featured-market')!,
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
    ...PANEL_LIBRARY.find((panel) => panel.id === 'market-summary')!,
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
    ...PANEL_LIBRARY.find((panel) => panel.id === 'price-implications')!,
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
    ...PANEL_LIBRARY.find((panel) => panel.id === 'price-chart')!,
    render: (ctx) => (
      <Panel title="PRICE SURFACE" badge="YES" status="live" count={ctx.bundle?.chart?.points.length || 0}>
        {priceLine(ctx.bundle?.chart?.points || [])}
      </Panel>
    ),
  },
  'sample-chain-trades': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'sample-chain-trades')!,
    render: (ctx) => (
      <Panel title="MARKET TAPE" badge="FOCUSED" status="live" count={focusedTrades(ctx).length}>
        {tradeList(focusedTrades(ctx), 12)}
      </Panel>
    ),
  },
  'oracle-timeline': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'oracle-timeline')!,
    render: (ctx) => (
      <Panel title="ORACLE TIMELINE" badge="ORACLE" status="live" count={focusedOracle(ctx).length}>
        {oracleList(focusedOracle(ctx), 12)}
      </Panel>
    ),
  },
  'bbo-monitor': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'bbo-monitor')!,
    render: (ctx) => (
      <Panel title="BBO MONITOR" badge="LIVE" status="live">
        {lobPanel(ctx, false)}
      </Panel>
    ),
  },
  'lob-depth': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'lob-depth')!,
    render: (ctx) => (
      <Panel title="LOB DEPTH" badge="LIVE" status="live">
        {lobPanel(ctx, true)}
      </Panel>
    ),
  },
  'related-news': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'related-news')!,
    render: (ctx) => (
      <Panel title="RELATED NEWS" badge={ctx.bundle?.content?.sourceMode || 'runtime-rss'} status="live" count={focusedContent(ctx).length}>
        {contentList(focusedContent(ctx), 'No linked articles yet.')}
      </Panel>
    ),
  },
  'related-video': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'related-video')!,
    render: (ctx) => (
      <Panel title="VIDEO FEED" badge="VIDEO" status="muted" count={contentByType(focusedContent(ctx), 'video').length}>
        {contentList(fallbackContent(focusedContent(ctx), 'video'), 'No linked videos yet.')}
      </Panel>
    ),
  },
  'report-feed': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'report-feed')!,
    render: (ctx) => (
      <Panel title="REPORT FEED" badge="REPORT" status="muted" count={contentByType(ctx.latestContent, 'report').length}>
        {contentList(fallbackContent(ctx.latestContent, 'report'), 'No linked reports yet.')}
      </Panel>
    ),
  },
  'research-feed': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'research-feed')!,
    render: (ctx) => (
      <Panel title="RESEARCH FEED" badge="RESEARCH" status="muted" count={contentByType(ctx.latestContent, 'research').length}>
        {contentList(fallbackContent(ctx.latestContent, 'research'), 'No linked research yet.')}
      </Panel>
    ),
  },
  'live-api-status': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'live-api-status')!,
    render: (ctx) => (
      <Panel title="LIVE API STATUS" badge={ctx.health?.apiStatus || 'OK'} status="live">
        {summaryRows([
          { label: 'API', value: String(ctx.health?.apiStatus || 'ok').toUpperCase() },
          { label: 'REDIS', value: ctx.health?.redis ? 'ONLINE' : 'OFF' },
          { label: 'LOB', value: ctx.bundle?.lob ? 'LIVE' : (ctx.health?.lobRuntime?.status || 'READY') },
          { label: 'CONTENT', value: ctx.bundle?.content?.sourceMode || ctx.health?.contentSync?.status || 'RUNTIME' },
        ])}
      </Panel>
    ),
  },
  'system-health': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'system-health')!,
    render: (ctx) => (
      <Panel title="SYSTEM HEALTH" badge={ctx.health?.redis ? 'REDIS' : 'READY'} status="live">
        {summaryRows([
          { label: 'DB', value: shortHash(ctx.health?.database || '--', 16, 0) },
          { label: 'MARKET', value: formatDate(ctx.health?.marketSync?.updatedAt || null) },
          { label: 'TRADE', value: formatDate(ctx.health?.tradeSync?.updatedAt || null) },
          { label: 'ORACLE', value: formatDate(ctx.health?.oracleSync?.updatedAt || null) },
          { label: 'PRICE', value: formatDate(ctx.health?.priceSync?.updatedAt || null) },
          { label: 'CONTENT', value: ctx.health?.contentSync?.status || '--' },
        ])}
      </Panel>
    ),
  },
  'commodities-watch': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'commodities-watch')!,
    size: 'wide',
    render: (ctx) => (
      <Panel title="COMMODITIES" badge="MACRO" status="live" count={ctx.commodities?.items.length || 0}>
        {marketTickerGrid(ctx.commodities?.items || [], 'No commodities loaded yet.')}
      </Panel>
    ),
  },
  'crypto-watch': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'crypto-watch')!,
    size: 'wide',
    render: (ctx) => (
      <Panel title="CRYPTO COMPLEX" badge="LIVE" status="live" count={ctx.crypto?.items.length || 0}>
        {marketTickerList(ctx.crypto?.items || [], 'No crypto prices loaded yet.')}
      </Panel>
    ),
  },
  'nba-scoreboard': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'nba-scoreboard')!,
    render: (ctx) => (
      <Panel title="NBA SCOREBOARD" badge="SPORTS" status="live" count={ctx.nba?.items.length || 0}>
        {nbaGames(ctx.nba?.items || [])}
      </Panel>
    ),
  },
  'nba-intel': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'nba-intel')!,
    size: 'wide',
    render: (ctx) => (
      <Panel title="NBA INTEL" badge="ESPN" status="live" count={ctx.nbaIntel?.items.length || 0}>
        {nbaIntelPanel(ctx)}
      </Panel>
    ),
  },
  'inflation-nowcast': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'inflation-nowcast')!,
    render: (ctx) => (
      <Panel title="INFLATION NOWCAST" badge="FED" status="live">
        {inflationNowcastPanel(ctx)}
      </Panel>
    ),
  },
  'alpha-signal': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'alpha-signal')!,
    render: (ctx) => (
      <Panel title="ALPHA SIGNAL" badge="LIVE" status="live" count={ctx.alphaSignals?.items.length || 0}>
        {alphaSignalList(ctx.alphaSignals?.items || [], 'No alpha signals loaded.', ctx.setSelectedMarketId)}
      </Panel>
    ),
  },
  'whale-tracker': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'whale-tracker')!,
    render: (ctx) => (
      <Panel title="WHALE TRACKER" badge="CHAIN" status="live" count={ctx.whaleTrades?.items.length || 0}>
        {tradeSignalList(ctx.whaleTrades?.items || [], 'No whale trades loaded.')}
      </Panel>
    ),
  },
  'suspicious-flow': {
    ...PANEL_LIBRARY.find((panel) => panel.id === 'suspicious-flow')!,
    render: (ctx) => (
      <Panel title="SUSPICIOUS FLOW" badge="WATCH" status="live" count={ctx.suspiciousTrades?.items.length || 0}>
        {tradeSignalList(ctx.suspiciousTrades?.items || [], 'No suspicious flow loaded.')}
      </Panel>
    ),
  },
};
