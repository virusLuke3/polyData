import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { emptyState, orderfilledList } from '@/panels/shared/renderers';
import { formatCompact, formatCurrencyCompact, formatPercent, formatRelative, formatSignedPercent, signedClass } from '@/panels/shared/formatters';
import type { ChartPayload, L2Level, MarketListItem, PanelRenderContext, PriceSummary, TradeRow } from '@/types';

type BookSide = 'yes' | 'no';

const CHART_RANGE_TABS = ['1h', '24h', '7d', '30d'];
const FOCUS_CHART = {
  width: 520,
  height: 220,
  top: 12,
  right: 62,
  bottom: 18,
  left: 10,
};

function tradeNotional(trade: TradeRow) {
  const size = Number(trade.size);
  const price = Number(trade.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return null;
  return size * price;
}

function marketTimeSubtitle(endDate?: string | null, createdAt?: string | null) {
  if (endDate) return `Closes ${formatRelative(endDate)}`;
  if (createdAt) return `Opened ${formatRelative(createdAt)}`;
  return 'Rolling market';
}

function resolveMarketTitle(ctx: PanelRenderContext, trade: TradeRow) {
  if (trade.marketTitle) return trade.marketTitle;
  if (trade.marketId && ctx.selectedMarket?.id === trade.marketId) return ctx.selectedMarket.title;
  return ctx.selectedMarket?.title || null;
}

function formatBookPrice(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${Math.round(numeric * 100)}c`;
}

function formatBookShares(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return numeric.toLocaleString('en-US', { maximumFractionDigits: numeric >= 100 ? 0 : 2 });
}

function formatBookTotal(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;
}

function accumulateNotional(levels: L2Level[]) {
  const working = levels.slice(0, 6).map((level) => ({
    price: Number(level.price) || 0,
    size: Number(level.size) || 0,
  }));
  let running = 0;
  return working.map((level) => {
    running += level.price * level.size;
    return { ...level, cumulative: running };
  });
}

function orderBookRows(levels: L2Level[], tone: 'bid' | 'ask') {
  const sorted = levels
    .slice()
    .sort((left, right) => {
      const leftPrice = Number(left.price) || 0;
      const rightPrice = Number(right.price) || 0;
      return tone === 'ask' ? rightPrice - leftPrice : rightPrice - leftPrice;
    });
  const rows = accumulateNotional(sorted);
  const max = Math.max(...rows.map((row) => row.cumulative), 1);
  return rows.map((level, index) => {
    const total = level.cumulative;
    return (
      <div className={`wm-focus-book-row ${tone}`} key={`${tone}-${index}-${level.price}`}>
        <div className="wm-focus-book-side-cell">
          <div className="wm-focus-book-side-fill" style={{ width: `${Math.min(100, (total / max) * 100)}%` }} />
          {index === 0 ? <span className={`wm-focus-book-chip ${tone}`}>{tone === 'ask' ? 'Asks' : 'Bids'}</span> : null}
        </div>
        <strong>{formatBookPrice(level.price)}</strong>
        <span>{formatBookShares(level.size)}</span>
        <em>{formatBookTotal(total)}</em>
      </div>
    );
  });
}

function marketLookup(markets: MarketListItem[], marketId: number | null) {
  return markets.find((market) => market.id === marketId) || null;
}

function orderbookOutcomeLabel(ctx: PanelRenderContext, side: BookSide) {
  const title = ctx.selectedMarket?.title || 'selected market';
  return `${side.toUpperCase()} · ${title}`;
}

function formatUnderlyingValue(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: numeric >= 1000 ? 0 : 2 })}`;
}

function buildLinePath(
  points: number[],
  {
    width,
    height,
    left,
    right,
    top,
    bottom,
    min,
    max,
  }: {
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    min: number;
    max: number;
  },
) {
  const span = max - min || 1;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  return points
    .map((value, index) => {
      const x = left + (index / Math.max(points.length - 1, 1)) * plotWidth;
      const y = top + (1 - (value - min) / span) * plotHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function buildAreaPath(
  path: string,
  { width, height, left, right, bottom }: { width: number; height: number; left: number; right: number; bottom: number },
) {
  return `${path} L ${width - right} ${height - bottom} L ${left} ${height - bottom} Z`;
}

function buildHorizontalTicks(min: number, max: number, count = 4) {
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / Math.max(count - 1, 1);
    return max - (max - min) * ratio;
  });
}

function outcomeCards(price: PriceSummary | null) {
  const yesPrice = Number(price?.latestYesPrice);
  const noPrice = Number(price?.latestNoPrice);
  const yesChange = Number(price?.change24h);
  const noChange = Number.isFinite(yesChange) ? -yesChange : NaN;

  return [
    {
      label: 'YES',
      price: Number.isFinite(yesPrice) ? yesPrice : null,
      change: Number.isFinite(yesChange) ? yesChange : null,
      tone: 'yes',
      cta: Number.isFinite(yesPrice) ? `Buy ${Math.round(yesPrice * 100)}%` : 'Buy Yes',
    },
    {
      label: 'NO',
      price: Number.isFinite(noPrice) ? noPrice : null,
      change: Number.isFinite(noChange) ? noChange : null,
      tone: 'no',
      cta: Number.isFinite(noPrice) ? `Buy ${Math.round(noPrice * 100)}%` : 'Buy No',
    },
  ];
}

function renderDetailChart(chart: ChartPayload | null) {
  const points = chart?.points || [];
  if (!points.length) return emptyState('No market history loaded yet.');
  const { width, height, left, right, top, bottom } = FOCUS_CHART;
  const tickLabel = (value: number) => (chart?.kind === 'underlying-price' ? formatUnderlyingValue(value) : `${Math.round(value * 100)}.0%`);

  if (chart?.kind !== 'underlying-price') {
    const yes = points.map((point) => Number(point.yesPrice)).filter((value) => Number.isFinite(value));
    const no = points.map((point) => Number(point.noPrice)).filter((value) => Number.isFinite(value));
    if (yes.length < 2) return emptyState('No probability history loaded yet.');
    const merged = [...yes, ...(no.length === yes.length ? no : [])];
    const rawMin = Math.min(...merged);
    const rawMax = Math.max(...merged);
    const rawSpan = rawMax - rawMin;
    const padding = Math.max(rawSpan * 0.16, 0.025);
    const min = Math.max(0, rawMin - padding);
    const max = Math.min(1, rawMax + padding);
    const yesPath = buildLinePath(yes, { width, height, left, right, top, bottom, min, max });
    const noPath = buildLinePath(no.length === yes.length ? no : yes.map((value) => 1 - value), { width, height, left, right, top, bottom, min, max });
    const ticks = buildHorizontalTicks(min, max, 4);
    const lastYes = yes[yes.length - 1] ?? 0;
    const lastNo = (no.length === yes.length ? no[no.length - 1] : 1 - lastYes) ?? 0;
    const span = max - min || 1;
    const plotHeight = height - top - bottom;
    const projectY = (value: number) => top + (1 - (value - min) / span) * plotHeight;

    return (
      <div className="wm-focus-chart-shell">
        <div className="wm-focus-chart-overlay-label yes" style={{ top: `${projectY(lastYes)}px` }}>
          YES {formatPercent(lastYes)}
        </div>
        <div className="wm-focus-chart-overlay-label no" style={{ top: `${projectY(lastNo)}px` }}>
          NO {formatPercent(lastNo)}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="wm-focus-chart-svg" preserveAspectRatio="none">
          {ticks.map((tick) => {
            const y = projectY(tick);
            return (
              <g key={tick}>
                <line x1={left} y1={y} x2={width - right} y2={y} className="wm-focus-chart-grid h" />
                <text x={width - right + 8} y={y + 4} className="wm-focus-chart-axis-text">{tickLabel(tick)}</text>
              </g>
            );
          })}
          {Array.from({ length: 4 }, (_, index) => {
            const x = left + ((width - left - right) / 3) * index;
            return <line key={index} x1={x} y1={top} x2={x} y2={height - bottom} className="wm-focus-chart-grid v" />;
          })}
          <path d={yesPath} className="wm-focus-chart-line yes" />
          {no.length === yes.length ? <path d={noPath} className="wm-focus-chart-line no" /> : null}
        </svg>
      </div>
    );
  }

  const clean = points
    .map((point, index) => ({ index, value: Number(point.value), timestamp: point.timestamp }))
    .filter((point) => Number.isFinite(point.value));

  if (clean.length < 2) return emptyState('No underlying price history loaded yet.');

  const target = Number(chart.targetPrice);
  const rawMin = Math.min(...clean.map((point) => point.value));
  const rawMax = Math.max(...clean.map((point) => point.value));
  const rawSpan = rawMax - rawMin || Math.max(rawMax * 0.01, 1);
  const padding = rawSpan * 0.18;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const span = max - min || 1;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const projectY = (value: number) => top + (1 - (value - min) / span) * plotHeight;
  const path = buildLinePath(clean.map((point) => point.value), { width, height, left, right, top, bottom, min, max });
  const areaPath = buildAreaPath(path, { width, height, left, right, bottom });
  const last = clean[clean.length - 1];
  if (!last) return emptyState('No underlying price history loaded yet.');
  const targetInRange = Number.isFinite(target) && target >= min && target <= max;
  const targetY = targetInRange ? projectY(target) : null;
  const ticks = buildHorizontalTicks(min, max, 4);

  return (
    <div className="wm-focus-chart-shell wm-line-chart-underlying">
      <svg viewBox={`0 0 ${width} ${height}`} className="wm-focus-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wmUnderlyingArea" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255, 152, 0, 0.26)" />
            <stop offset="100%" stopColor="rgba(255, 152, 0, 0.02)" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = projectY(tick);
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} className="wm-focus-chart-grid h" />
              <text x={width - right + 8} y={y + 4} className="wm-focus-chart-axis-text">{tickLabel(tick)}</text>
            </g>
          );
        })}
        {Array.from({ length: 4 }, (_, index) => {
          const x = left + (plotWidth / 3) * index;
          return <line key={index} x1={x} y1={top} x2={x} y2={height - bottom} className="wm-focus-chart-grid v" />;
        })}
        {targetY !== null ? <line x1="0" y1={targetY} x2={width} y2={targetY} className="wm-focus-target-line" /> : null}
        <path d={areaPath} fill="url(#wmUnderlyingArea)" />
        <path d={path} className="wm-focus-chart-line underlying" />
        <circle cx={left + (last.index / Math.max(clean.length - 1, 1)) * plotWidth} cy={projectY(last.value)} r="4.2" fill="#ff9a1f" />
      </svg>
    </div>
  );
}

export function FocusedMarketStrip(ctx: PanelRenderContext) {
  const focusedMarket = ctx.selectedMarket;
  const chart = ctx.bundle?.chart || null;
  const chartPoints = chart?.points || [];
  const price = ctx.bundle?.price ?? null;
  const lob = ctx.bundle?.lob;
  const trades = ctx.bundle?.trades || [];
  const marketStats = marketLookup(ctx.markets, ctx.selectedMarketId);
  const [bookSide, setBookSide] = useState<BookSide>('yes');
  const activeBook = bookSide === 'no' ? lob?.no : lob?.yes;
  const activePrice = bookSide === 'no'
    ? (price?.latestNoPrice ?? price?.latestPrice)
    : (price?.latestYesPrice ?? price?.latestPrice);
  const spreadValue = activeBook?.spread;
  const outcomes = outcomeCards(price);
  const shouldShowOutcomeRail = Number(marketStats?.outcomeCount || 2) > 2;

  return (
    <section className="wm-focus-strip">
      <Panel
        title="MARKET DETAIL"
        badge="selected ×"
        status="live"
        className="wm-focus-panel wm-focus-detail-panel"
      >
        <div className="wm-focus-detail">
          <div className="wm-focus-detail-top">
            <div className="wm-focus-detail-copy">
              <strong className="wm-focus-title">{focusedMarket?.title || 'No market selected.'}</strong>
              <div className="wm-focus-subtitle">
                {marketTimeSubtitle(focusedMarket?.endDate || null, focusedMarket?.createdAt || marketStats?.createdAt || null)}
              </div>
            </div>
            <div className="wm-focus-price-hero">
              <strong>{formatPercent(price?.latestPrice || focusedMarket?.latestPrice)}</strong>
              <span className={signedClass(price?.change24h)}>{formatSignedPercent(price?.change24h)}</span>
            </div>
          </div>

          <div className="wm-focus-chart-card">
            <div className="wm-focus-chart-tabs">
              {CHART_RANGE_TABS.map((tab) => (
                <span key={tab} className={tab === '24h' ? 'active' : ''}>{tab}</span>
              ))}
              <i>UTC</i>
            </div>
            <div className={`wm-focus-detail-grid${shouldShowOutcomeRail ? '' : ' compact'}`}>
              <div className="wm-focus-chart-wrap">
                {chartPoints.length ? renderDetailChart(chart) : emptyState('No market history loaded yet.')}
              </div>
              {shouldShowOutcomeRail ? (
                <aside className="wm-focus-outcome-rail" aria-label="outcomes">
                  {outcomes.map((outcome) => (
                    <button type="button" className={`wm-focus-outcome-card ${outcome.tone}`} key={outcome.label}>
                      <div className="wm-focus-outcome-top">
                        <span>{outcome.label}</span>
                        <strong>{outcome.price == null ? '--' : formatPercent(outcome.price)}</strong>
                      </div>
                      <div className={`wm-focus-outcome-change ${signedClass(outcome.change)}`}>
                        {outcome.change == null ? '--' : formatSignedPercent(outcome.change)}
                      </div>
                      <div className="wm-focus-outcome-cta">{outcome.cta}</div>
                    </button>
                  ))}
                </aside>
              ) : null}
            </div>
          </div>

          <div className="wm-focus-inline-stats">
            <span><em>Vol</em> {formatCurrencyCompact(price?.volume24h || marketStats?.volume24h)}</span>
            <span><em>24h</em> {formatCompact(price?.tradeCount24h || marketStats?.tradeCount24h)} trades</span>
            <span><em>Yes</em> {formatPercent(price?.latestYesPrice)}</span>
            <span><em>No</em> {formatPercent(price?.latestNoPrice)}</span>
          </div>
        </div>
      </Panel>

      <Panel
        title="ORDER BOOK"
        badge="live"
        status="live"
        className="wm-focus-panel wm-focus-book-panel"
        controls={focusedMarket ? <span className="wm-focus-header-note">{orderbookOutcomeLabel(ctx, bookSide)}</span> : undefined}
      >
        {!lob || !activeBook ? (
          emptyState('LOB runtime unavailable for the selected market.')
        ) : (
          <div className="wm-focus-book">
            <div className="wm-focus-book-tabs">
              <button type="button" className={bookSide === 'yes' ? 'active' : ''} onClick={() => setBookSide('yes')}>YES</button>
              <button type="button" className={bookSide === 'no' ? 'active' : ''} onClick={() => setBookSide('no')}>NO</button>
            </div>
            <div className="wm-focus-book-header">
              <span>BOOK</span>
              <span>PRICE</span>
              <span>SHARES</span>
              <span>TOTAL</span>
            </div>
            <div className="wm-focus-book-ladder">
              {orderBookRows(activeBook.asks || [], 'ask')}
              <div className="wm-focus-book-mid">
                <span>Last: {formatBookPrice(activePrice)}</span>
                <strong>Spread: {formatBookPrice(spreadValue)}</strong>
              </div>
              {orderBookRows(activeBook.bids || [], 'bid')}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="ORDERFILLED FLOW"
        badge="FOCUSED"
        status="live"
        count={trades.length}
        className="wm-focus-panel wm-focus-trades-panel wm-orderfilled-panel"
        controls={focusedMarket ? <span className="wm-focus-header-note">{focusedMarket.title}</span> : undefined}
      >
        <div className="wm-focus-trades">
          <div className="wm-focus-trades-meta">
            <span>{trades[0]?.timestamp ? `latest ${formatRelative(trades[0].timestamp)}` : 'waiting for trades'}</span>
            <strong>{trades[0] && tradeNotional(trades[0]) ? `$${formatCompact(tradeNotional(trades[0]))}` : '--'}</strong>
          </div>
          {trades.length
            ? orderfilledList(trades, 12, (trade) => resolveMarketTitle(ctx, trade))
            : emptyState('Waiting for trade rows.')}
        </div>
      </Panel>
    </section>
  );
}
