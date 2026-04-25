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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', fontFamily: 'monospace', padding: '12px' }}>
      {items.map((item, index) => {
        const isCluster = (item.addresses?.length || 0) > 1 || String(item.sourceLabel || '').toLowerCase().includes('cluster');
        const icon = isCluster ? '👥' : '🐳';
        const sourceName = item.sourceLabel ? item.sourceLabel.toUpperCase() : (isCluster ? 'CLUSTER' : 'WHALE');
        const bias = signalBias(item);
        const isBull = bias === 'bullish';
        const color = isBull ? '#39ff73' : '#ff6464';
        const triangle = isBull ? '▲' : '▼';
        const action = signalAction(item);
        
        let timeStr = formatRelative(item.timestamp || null);
        timeStr = timeStr.replace(' minutes ago', 'm').replace(' minutes', 'm').replace(' hours ago', 'h').replace(' hours', 'h').replace(' seconds ago', 's').replace(' seconds', 's');
        if (timeStr.includes('just now')) timeStr = '1m';

        const metrics = item.metrics || null;
        const volume = metrics?.totalNotional || item.notional || 0;
        const count = metrics?.tradeCount || 1;
        const wallets = metrics?.accountCount || item.addresses?.length || 1;
        const prob = formatPercent(metrics?.currentProbability || item.price || 0);

        return (
          <article key={`${item.title || item.marketTitle || 'signal'}-${index}`} style={{ display: 'flex', flexDirection: 'column', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '15px' }}>{icon}</span>
                <span style={{ color: '#aaa', letterSpacing: '0.05em' }}>{sourceName}</span>
                <span style={{ color: color, fontWeight: 'bold' }}>{triangle} {bias}</span>
              </div>
              <div style={{ color: '#888' }}>{timeStr}</div>
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ color: '#ff6464', fontSize: '11px', fontWeight: 'bold', background: 'rgba(255,100,100,0.1)', padding: '2px 4px', borderRadius: '4px', height: 'fit-content' }}>STR</div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <p style={{ color: '#eee', fontSize: '14px', lineHeight: '1.4', margin: '0 0 12px 0', fontFamily: 'sans-serif' }}>
                  {item.headline || item.summary || item.title || 'Signal activity detected'}
                </p>
                
                <div style={{ background: 'rgba(57,255,115,0.05)', border: `1px solid rgba(57,255,115,0.2)`, borderRadius: '4px', padding: '8px 12px', marginBottom: '12px', cursor: 'pointer' }} onClick={() => item.marketId && onMarketSelect?.(item.marketId)}>
                  <div style={{ display: 'flex', gap: '8px', color: '#39ff73', fontSize: '13px', fontWeight: 'bold' }}>
                    <span>{triangle}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.marketTitle || item.title || 'Market signal'}</span>
                  </div>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#aaa', fontFamily: 'monospace' }}>
                  <div style={{ display: 'flex', gap: '16px' }}>
                     <div style={{ display: 'flex', gap: '4px' }}>
                       <span style={{ color: '#eee' }}>${formatCompact(volume)}</span>
                       <span>vol</span>
                     </div>
                     <div style={{ display: 'flex', gap: '4px' }}>
                       <span style={{ color: '#eee' }}>{count}</span>
                       <span>trades</span>
                     </div>
                     <div style={{ display: 'flex', gap: '4px' }}>
                       <span style={{ color: '#eee' }}>{wallets}</span>
                       <span>wallet(s)</span>
                     </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ color: '#eee' }}>@{prob}</span>
                    <button style={{ background: 'rgba(57,255,115,0.1)', color: '#39ff73', border: '1px solid rgba(57,255,115,0.3)', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold' }}>
                      {action.side} {action.outcome}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}


function whaleTrackerList(items: RuntimeTradeSignal[], emptyMessage: string, onMarketSelect?: (marketId: number) => void) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-poly-market-list">
      <div style={{ display: 'flex', gap: '16px', margin: '4px 12px 8px', fontSize: '12px', color: '#888', fontWeight: 'bold', fontFamily: 'monospace' }}>
        <span style={{ color: '#fff', borderBottom: '1px solid #22c55e', paddingBottom: '4px' }}>Trades</span>
        <span style={{ cursor: 'pointer' }}>Flow</span>
        <span style={{ cursor: 'pointer' }}>Signals</span>
      </div>
      {items.map((item, index) => {
         let timeStr = formatRelative(item.timestamp || null);
         timeStr = timeStr.replace(' minutes ago', 'm').replace(' minutes', 'm').replace(' hours ago', 'h').replace(' hours', 'h').replace(' seconds ago', 's').replace(' seconds', 's');
         if (timeStr.includes('just now')) timeStr = '1m';
         
         const side = String(item.side || 'BUY').toUpperCase();
         const isBuy = side === 'BUY';
         const color = isBuy ? '#22c55e' : '#ef4444';
         const addressFull = item.txHash || item.addresses?.[0]?.address || 'unknown';
         const address = shortHash(addressFull, 5, 0).replace('...', '');
         
         return (
           <button
             key={`${item.txHash || 'trade'}-${index}`}
             type="button"
             className="wm-poly-market-card"
             style={{ borderLeftColor: color, paddingTop: '10px', paddingBottom: '10px' }}
             onClick={() => item.marketId && onMarketSelect?.(item.marketId)}
             disabled={!item.marketId}
           >
             <div className="wm-poly-market-card-main">
               <div className="wm-poly-market-meta">
                 <span className="wm-poly-market-dot" style={{ backgroundColor: color }} />
                 <span>{address}</span>
                 <span>·</span>
                 <span>{timeStr}</span>
                 <span>·</span>
                 <strong style={{ color }}>{side}</strong>
                 <strong style={{ marginLeft: 'auto', color: '#fff', fontSize: '12px' }}>${formatCompact(item.notional || 0)}</strong>
               </div>
               <strong className="wm-poly-market-title" style={{ fontSize: '13px', marginTop: '6px' }}>
                 {item.marketTitle || 'Unknown Market'}
               </strong>
             </div>
           </button>
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
  whaleTrackerList,
};
