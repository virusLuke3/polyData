import type { ChartPoint, ContentItem, OracleEvent, RuntimeMarketTicker, RuntimeTradeSignal, TradeRow } from '@/types';
import { formatCompact, formatDate, formatPercent, formatRelative, shortHash } from './formatters';

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


export {
  emptyState,
  priceLine,
  sparkline,
  tradeList,
  oracleList,
  contentList,
  summaryRows,
  marketTickerGrid,
  marketTickerList,
  alphaSignalList,
  tradeSignalList,
};
