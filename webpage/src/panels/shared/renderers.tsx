import type { ChartPoint, ContentItem, L2Level, OracleEvent, RuntimeMarketTicker, RuntimeTradeSignal, TradeRow } from '@/types';
import { formatCompact, formatDate, formatPercent, formatRelative, shortHash } from './formatters';

function emptyState(message: string) {
  return (
    <div className="wm-empty wm-empty-card">
      <span>Standby</span>
      <strong>{message}</strong>
      <em>Panel will hydrate as soon as the runtime feed returns rows.</em>
    </div>
  );
}

function priceLine(points: ChartPoint[]) {
  const isRawValueSeries = points.some((point) => point.value !== undefined && point.value !== null);
  const clean = points
    .map((point, index) => ({ index, value: Number(isRawValueSeries ? point.value : point.yesPrice) }))
    .filter((point) => Number.isFinite(point.value));

  if (clean.length < 2) return emptyState('No price history loaded yet.');

  const width = 520;
  const height = 180;
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
  const axisValue = (value: number) => (isRawValueSeries ? `$${formatCompact(value)}` : formatPercent(value));

  return (
    <div className="wm-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="wm-line-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wmPriceLine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#39ff73" />
            <stop offset="55%" stopColor="#88ffbf" />
            <stop offset="100%" stopColor="#f5f7f7" />
          </linearGradient>
          <linearGradient id="wmPriceArea" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(57, 255, 115, 0.26)" />
            <stop offset="100%" stopColor="rgba(57, 255, 115, 0.02)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#wmPriceArea)" />
        <path d={path} fill="none" stroke="url(#wmPriceLine)" strokeWidth="2.8" strokeLinecap="round" />
      </svg>
      <div className="wm-line-axis">
        <span>LOW {axisValue(min)}</span>
        <span>HIGH {axisValue(max)}</span>
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

function tradeNotional(trade: TradeRow) {
  const size = Number(trade.size);
  const price = Number(trade.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return null;
  return size * price;
}

function tradeActor(trade: TradeRow) {
  return shortHash(trade.taker || trade.maker || trade.txHash || '', 7, 4);
}

function tradeActorFull(trade: TradeRow) {
  return trade.taker || trade.maker || trade.txHash || '--';
}

function formatDateExact(value?: string | null) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function tradeList(trades: TradeRow[], limit = 8) {
  if (!trades.length) return emptyState('Waiting for trade rows.');
  return (
    <div className="wm-tape-list">
      {trades.slice(0, limit).map((trade) => {
        const side = String(trade.side || '').toUpperCase();
        const tone = side === 'BUY' ? 'positive' : 'critical';
        return (
          <article className={`wm-tape-row ${tone}`} key={`${trade.txHash}-${trade.logIndex}`}>
            <div className="wm-tape-time">{formatRelative(trade.timestamp || null)}</div>
            <div className="wm-tape-party">{tradeActor(trade)}</div>
            <div className="wm-tape-main">
              <div className="wm-tape-title">{trade.marketTitle || `Market #${trade.marketId || '--'}`}</div>
              <div className="wm-tape-meta">
                <span>{shortHash(trade.txHash)}</span>
                <span>{formatDate(trade.timestamp || null)}</span>
              </div>
            </div>
            <div className="wm-tape-action">
              <span className={`wm-chip ${tone}`}>{side || 'FLOW'}</span>
              <em>{String(trade.outcome || '--').toUpperCase()}</em>
            </div>
            <div className="wm-tape-price">
              <strong>{formatPercent(trade.price)}</strong>
              <span>{tradeNotional(trade) ? `$${formatCompact(tradeNotional(trade))}` : formatCompact(trade.size)}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function tradePriceCents(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${Math.round(numeric * 100)}c`;
}

function orderfilledList(
  trades: TradeRow[],
  limit = 8,
  resolveMarketTitle?: (trade: TradeRow) => string | null | undefined,
) {
  if (!trades.length) return emptyState('Waiting for trade rows.');
  return (
    <div className="wm-orderfilled-list">
      {trades.slice(0, limit).map((trade) => {
        const side = String(trade.side || '').toUpperCase();
        const outcome = String(trade.outcome || '--').toUpperCase();
        const tone = side === 'BUY' ? 'positive' : 'critical';
        const actor = tradeActor(trade);
        const actorFull = tradeActorFull(trade);
        const marketTitle = resolveMarketTitle?.(trade) || trade.marketTitle || null;
        return (
          <article className={`wm-orderfilled-row ${tone}`} key={`${trade.txHash}-${trade.logIndex}`}>
            <div className="wm-orderfilled-top">
              <div className="wm-orderfilled-headline">
                <span className={`wm-chip ${tone}`}>{side || 'FLOW'}</span>
                <span className={`wm-orderfilled-outcome ${outcome === 'YES' ? 'yes' : outcome === 'NO' ? 'no' : ''}`}>{outcome}</span>
                <strong>{tradePriceCents(trade.price)}</strong>
                <em>{tradeNotional(trade) ? `$${formatCompact(tradeNotional(trade))}` : '$--'}</em>
              </div>
              {trade.marketId ? <span className="wm-orderfilled-market-id">MKT #{trade.marketId}</span> : null}
            </div>
            <div className="wm-orderfilled-title">{marketTitle || 'Untitled market'}</div>
            <div className="wm-orderfilled-meta">
              <span>{formatRelative(trade.timestamp || null)}</span>
              <span>{actor}</span>
            </div>
            <div className="wm-orderfilled-tooltip" role="tooltip" aria-hidden="true">
              <div className="wm-orderfilled-tooltip-title">{marketTitle || `Market #${trade.marketId || '--'}`}</div>
              <div className="wm-orderfilled-tooltip-row">
                <span>Address</span>
                <strong>{actorFull}</strong>
              </div>
              <div className="wm-orderfilled-tooltip-row">
                <span>Time</span>
                <strong>{formatDateExact(trade.timestamp)}</strong>
              </div>
              {trade.marketId ? (
                <div className="wm-orderfilled-tooltip-row">
                  <span>Market</span>
                  <strong>#{trade.marketId}</strong>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function oracleTone(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('sett')) return 'positive';
  if (normalized.includes('disput') || normalized.includes('reject')) return 'critical';
  if (normalized.includes('propos')) return 'warning';
  return 'muted';
}

function oracleList(events: OracleEvent[], limit = 8) {
  if (!events.length) return emptyState('No oracle activity loaded.');
  return (
    <div className="wm-oracle-list">
      {events.slice(0, limit).map((event, index) => {
        const price = event.settledPrice ?? event.proposedPrice;
        return (
          <article className="wm-oracle-event-card" key={`${event.id || index}-${event.blockNumber || index}`}>
            <div className="wm-oracle-event-top">
              <strong>{event.marketTitle || event.eventStatus || 'Oracle event'}</strong>
              <span className={`wm-status-pill ${oracleTone(event.eventStatus)}`}>{event.eventStatus || 'event'}</span>
            </div>
            <div className="wm-oracle-event-middle">
              <span>{event.sourceAdapter || event.sourceOracle || event.requester || 'uma oracle'}</span>
              <em>{price !== null && price !== undefined ? formatPercent(price) : 'pending'}</em>
            </div>
            <div className="wm-oracle-event-meta">
              <span>{formatDate(event.eventTime || null)}</span>
              <span>{shortHash(event.questionId || event.conditionId || event.txHash || '', 8, 5)}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function contentTone(type?: string | null) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('report')) return 'report';
  if (normalized.includes('research')) return 'research';
  return 'news';
}

function contentList(items: ContentItem[], emptyMessage: string) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-intel-list">
      {items.slice(0, 8).map((item, index) => {
        const tone = contentTone(item.contentType);
        return (
          <a className={`wm-intel-card ${tone}`} href={item.url || '#'} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}>
            <div className="wm-intel-topline">
              <div className="wm-news-source">{item.source || item.contentType || 'intel'}</div>
              <span className={`wm-status-pill ${tone === 'news' ? 'positive' : 'muted'}`}>{(item.contentType || tone).toUpperCase()}</span>
            </div>
            <div className="wm-news-title">{item.title || 'Untitled item'}</div>
            {item.summary ? <p className="wm-intel-summary">{item.summary}</p> : null}
            <div className="wm-news-meta">
              <span>{formatDate(item.publishedAt || null)}</span>
              <span>{tone}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function summaryTone(value: string) {
  const normalized = String(value).toLowerCase();
  if (normalized.includes('ok') || normalized.includes('online') || normalized.includes('live') || normalized.includes('active')) return 'positive';
  if (normalized.includes('off') || normalized.includes('down') || normalized.includes('error')) return 'critical';
  if (normalized.includes('warn') || normalized.includes('delay') || normalized.includes('pending')) return 'warning';
  return 'muted';
}

function summaryRows(rows: Array<{ label: string; value: string }>) {
  return (
    <div className="wm-summary-grid">
      {rows.map((row) => (
        <div className={`wm-summary-row ${summaryTone(row.value)}`} key={row.label}>
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
      {items.map((item) => {
        const isUp = (item.changePercent || 0) >= 0;
        return (
          <article className="wm-market-ticker-card" key={item.symbol}>
            <div className="wm-market-ticker-top">
              <span>{item.label}</span>
              <strong>{item.price == null ? '--' : Number(item.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong>
            </div>
            <div className="wm-market-spark-wrap">{sparkline(item.points || [], isUp ? '#39ff73' : '#ff6464')}</div>
            <div className={`wm-market-change ${isUp ? 'up' : 'down'}`}>
              {item.changePercent == null ? '--' : `${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`}
            </div>
          </article>
        );
      })}
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
            <div className="wm-ticker-spark">{sparkline(item.points || [], isUp ? '#39ff73' : '#ff6464')}</div>
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
                  <span className="wm-signal-icon">{item.sourceTag?.slice(0, 1) || 'S'}</span>
                  <strong>{item.sourceLabel || (item.relatedContent?.length ? 'NEWS+$' : 'CHAIN+$')}</strong>
                  <em className={bias}>{bias}</em>
                </div>
                <div className="wm-signal-topline-right">
                  {!!item.timestamp && <span className="wm-signal-age">{formatRelative(item.timestamp)}</span>}
                  <span className={`wm-signal-severity ${severity}`}>{severity.toUpperCase()}</span>
                </div>
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

function levelTotal(levels: L2Level[]) {
  return levels.reduce((sum, level) => {
    const size = Number(level.size);
    return Number.isFinite(size) ? sum + size : sum;
  }, 0);
}

export {
  emptyState,
  levelTotal,
  orderfilledList,
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
