import { type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { emptyState, orderfilledList } from '@/panels/shared/renderers';
import { formatCompact, formatCurrencyCompact, formatPercent, formatRelative, formatSignedPercent, signedClass } from '@/panels/shared/formatters';
import { fetchMarketLobByToken } from '@/services/api';
import type {
  ChartPayload,
  L2Level,
  LobPayload,
  MarketGroupChartPayload,
  MarketGroupChartRange,
  MarketGroupDetail,
  MarketGroupOutcome,
  MarketListItem,
  PanelRenderContext,
  PriceSummary,
  TradeRow,
} from '@/types';

type BookSide = 'yes' | 'no';
type FocusedPanelSlotRenderer = (panelId: string, className: string, panel: ComponentChildren) => ComponentChildren;
type FocusedMarketStripProps = PanelRenderContext & {
  renderPanelSlot?: FocusedPanelSlotRenderer;
};

const CHART_RANGE_TABS: Array<{ label: string; value: MarketGroupChartRange }> = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '1d' },
  { label: '7d', value: '1w' },
  { label: '30d', value: '1m' },
];
const FOCUS_CHART = {
  width: 520,
  height: 258,
  top: 18,
  right: 58,
  bottom: 34,
  left: 12,
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

function bookDepthTotal(levels?: L2Level[]) {
  return (levels || []).slice(0, 6).reduce((total, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) return total;
    return total + price * size;
  }, 0);
}

function hasBookLevels(lob?: LobPayload | null) {
  return Boolean(
    lob
      && ((lob.yes?.asks || []).length
        || (lob.yes?.bids || []).length
        || (lob.no?.asks || []).length
        || (lob.no?.bids || []).length),
  );
}

function hasSideBookLevels(side?: { asks?: L2Level[]; bids?: L2Level[] } | null) {
  return Boolean(side && ((side.asks || []).length || (side.bids || []).length));
}

function isTerminalProbability(value?: string | number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && (numeric <= 0.001 || numeric >= 0.999);
}

function safeLiveProbability(value: string | number | null | undefined, isLive: boolean) {
  return isLive ? value : null;
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
    const depth = Math.min(100, (total / max) * 100);
    return (
      <div
        className={`wm-focus-book-row ${tone}`}
        key={`${tone}-${index}-${level.price}-${level.size}`}
        style={{ '--wm-book-row-delay': `${index * 28}ms` } as Record<string, string>}
      >
        <div className="wm-focus-book-depth-track" aria-hidden="true">
          <div className="wm-focus-book-side-fill" style={{ width: `${depth}%` }} />
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

function orderbookOutcomeLabel(ctx: PanelRenderContext, side: BookSide, selectedOutcome: MarketGroupOutcome | null) {
  const title = selectedOutcome?.label || ctx.selectedMarket?.title || 'selected market';
  return `${side.toUpperCase()} · ${title}`;
}

function formatUnderlyingValue(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: numeric >= 1000 ? 0 : 2 })}`;
}

function compactDateLabel(value: number) {
  if (!Number.isFinite(value)) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function chartTimeTicks(points: Array<{ timestamp: string }>, count = 4) {
  const stamps = points
    .map((point) => new Date(point.timestamp).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!stamps.length) return [];
  const minTs = stamps[0] ?? 0;
  const maxTs = stamps[stamps.length - 1] ?? minTs;
  if (maxTs <= minTs) return [{ ts: minTs, ratio: 0, label: compactDateLabel(minTs) }];
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / Math.max(count - 1, 1);
    const ts = minTs + (maxTs - minTs) * ratio;
    return { ts, ratio, label: compactDateLabel(ts) };
  });
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

function buildTimedLinePath(
  points: Array<{ timestamp: string; price: number }>,
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
  if (points.length < 2) return '';
  const stamped = points
    .map((point) => ({ ...point, ts: new Date(point.timestamp).getTime() }))
    .filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.price))
    .sort((leftPoint, rightPoint) => leftPoint.ts - rightPoint.ts);
  if (stamped.length < 2) return '';
  const minTs = stamped[0]?.ts ?? 0;
  const maxTs = stamped[stamped.length - 1]?.ts ?? minTs;
  const tsSpan = Math.max(maxTs - minTs, 1);
  const valueSpan = max - min || 1;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  return stamped
    .map((point, index) => {
      const x = left + ((point.ts - minTs) / tsSpan) * plotWidth;
      const y = top + (1 - (point.price - min) / valueSpan) * plotHeight;
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

function eventOutcomeCards(detail: MarketGroupDetail | null) {
  return (detail?.outcomes || []).map((outcome) => ({
    ...outcome,
    price: Number(outcome.yesPrice),
    change: Number(outcome.change24h),
  }));
}

type LegacyOutcomeCard = {
  label: string;
  price: number | null;
  change: number | null;
  tone: string;
  cta: string;
};

type EventOutcomeCard = MarketGroupOutcome & {
  price: number;
  change: number;
};

function renderEventDetailChart(chart: MarketGroupChartPayload | null, selectedOutcomeKey: string | null) {
  const series = (chart?.series || []).filter((entry) => (entry.points || []).length > 1);
  if (!series.length) return emptyState('Fresh market: waiting for event price history to print.');
  const { width, height, left, right, top, bottom } = FOCUS_CHART;
  const allValues = series.flatMap((entry) => (entry.points || []).map((point) => Number(point.price)).filter((value) => Number.isFinite(value)));
  if (!allValues.length) return emptyState('No event probability history loaded yet.');
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = Math.max((rawMax - rawMin) * 0.16, 0.025);
  const min = Math.max(0, rawMin - padding);
  const max = Math.min(1, rawMax + padding);
  const span = max - min || 1;
  const plotHeight = height - top - bottom;
  const projectY = (value: number) => top + (1 - (value - min) / span) * plotHeight;
  const ticks = buildHorizontalTicks(min, max, 4);
  const selectedSeries = series.find((entry) => entry.outcomeKey === selectedOutcomeKey) || series[0];
  const selectedLast = selectedSeries?.points?.length ? Number(selectedSeries.points[selectedSeries.points.length - 1]?.price) : null;
  const cleanSeries = series
    .map((entry) => ({
      entry,
      points: (entry.points || [])
        .map((point) => ({ timestamp: point.timestamp, price: Number(point.price) }))
        .filter((point) => Number.isFinite(point.price) && Boolean(point.timestamp)),
    }))
    .filter((entry) => entry.points.length > 1);
  const selectedClean = cleanSeries.find((entry) => entry.entry.outcomeKey === selectedSeries?.outcomeKey) || cleanSeries[0] || null;
  const selectedPath = selectedClean
    ? buildTimedLinePath(selectedClean.points, { width, height, left, right, top, bottom, min, max })
    : '';
  const selectedAreaPath = selectedPath ? buildAreaPath(selectedPath, { width, height, left, right, bottom }) : '';
  const selectedColor = selectedSeries?.color || '#ffbc6c';
  const selectedLabel = selectedSeries?.label || 'Selected';
  const compactLabel = selectedLabel.length > 28 ? `${selectedLabel.slice(0, 25)}...` : selectedLabel;
  const lastPoint = selectedClean?.points?.[selectedClean.points.length - 1] || null;
  const lastPointX = lastPoint && selectedClean
    ? (() => {
        const stamped = selectedClean.points.map((point) => new Date(point.timestamp).getTime()).filter(Number.isFinite);
        const minTs = stamped[0] ?? 0;
        const maxTs = stamped[stamped.length - 1] ?? minTs;
        return left + ((new Date(lastPoint.timestamp).getTime() - minTs) / Math.max(maxTs - minTs, 1)) * (width - left - right);
      })()
    : null;
  const timeTicks = chartTimeTicks(cleanSeries.flatMap((entry) => entry.points), 4);

  return (
    <div className="wm-focus-chart-shell wm-focus-event-chart-shell">
      {selectedSeries && selectedLast != null && Number.isFinite(selectedLast) ? (
        <div
          className="wm-focus-chart-overlay-label current"
          style={{ top: `${projectY(selectedLast)}px`, color: selectedColor }}
        >
          <span>{compactLabel}</span>
          <strong>{formatPercent(selectedLast)}</strong>
        </div>
      ) : null}
      <div className="wm-focus-chart-watermark" aria-hidden="true">Polymarket</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="wm-focus-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wm-event-selected-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={selectedColor} stopOpacity="0.24" />
            <stop offset="72%" stopColor={selectedColor} stopOpacity="0.03" />
            <stop offset="100%" stopColor={selectedColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = projectY(tick);
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} className="wm-focus-chart-grid h" />
              <text x={width - right + 8} y={y + 4} className="wm-focus-chart-axis-text">{`${Math.round(tick * 100)}.0%`}</text>
            </g>
          );
        })}
        {Array.from({ length: 4 }, (_, index) => {
          const x = left + ((width - left - right) / 3) * index;
          return <line key={index} x1={x} y1={top} x2={x} y2={height - bottom} className="wm-focus-chart-grid v" />;
        })}
        {timeTicks.map((tick) => {
          const x = left + tick.ratio * (width - left - right);
          return (
            <text key={`${tick.ts}-${tick.label}`} x={x} y={height - 9} className="wm-focus-chart-time-text">
              {tick.label}
            </text>
          );
        })}
        {selectedAreaPath ? <path d={selectedAreaPath} className="wm-focus-chart-area event-selected" /> : null}
        {cleanSeries.filter(({ entry }) => entry.outcomeKey !== selectedSeries?.outcomeKey).map(({ entry, points }) => {
          const path = buildTimedLinePath(points, { width, height, left, right, top, bottom, min, max });
          if (!path) return null;
          return (
            <path
              key={entry.outcomeKey || entry.label || path}
              d={path}
              className="wm-focus-chart-line event-series muted"
              style={{ stroke: entry.color || '#7cb6ff' }}
            />
          );
        })}
        {selectedPath ? (
          <path
            d={selectedPath}
            className="wm-focus-chart-line event-series selected"
            style={{ stroke: selectedColor }}
          />
        ) : null}
        {lastPoint && lastPointX != null ? (
          <circle cx={lastPointX} cy={projectY(lastPoint.price)} r="4" className="wm-focus-chart-endpoint" style={{ fill: selectedColor }} />
        ) : null}
      </svg>
    </div>
  );
}

function eventChartLegend(
  detail: MarketGroupDetail | null,
  chart: MarketGroupChartPayload | null,
  selectedOutcomeKey: string | null,
  onSelect: (outcome: MarketGroupOutcome) => void,
) {
  const outcomes = detail?.outcomes || [];
  const seriesColorMap = new Map((chart?.series || []).map((entry) => [entry.outcomeKey || '', entry.color || '#7cb6ff']));
  const visible = outcomes
    .slice()
    .sort((left, right) => Number(right.yesPrice || 0) - Number(left.yesPrice || 0))
    .slice(0, 12);
  if (!visible.length) return null;
  return (
    <div className="wm-focus-event-legend" aria-label="event outcomes legend">
      {visible.map((outcome) => {
        const key = outcome.outcomeKey || '';
        const active = key === selectedOutcomeKey;
        return (
          <button
            key={key || outcome.label || outcome.marketId || outcome.gammaMarketId}
            type="button"
            className={`wm-focus-event-legend-item${active ? ' active' : ''}`}
            onClick={() => onSelect(outcome)}
          >
            <span
              className="wm-focus-event-legend-dot"
              style={{ background: seriesColorMap.get(key) || '#7cb6ff' }}
              aria-hidden="true"
            />
            <span className="wm-focus-event-legend-label">{outcome.label || 'Outcome'}</span>
            <strong>{formatPercent(outcome.yesPrice)}</strong>
            <em className={signedClass(outcome.change24h)}>{formatSignedPercent(outcome.change24h)}</em>
          </button>
        );
      })}
    </div>
  );
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

export function FocusedMarketStrip(props: FocusedMarketStripProps) {
  const { renderPanelSlot, ...ctx } = props;
  const focusedMarket = ctx.selectedMarket;
  const selectedGroup = ctx.selectedMarketGroup;
  const detail = ctx.selectedMarketGroupDetail;
  const eventChart = ctx.selectedMarketGroupChart;
  const selectedOutcome = (
    (detail?.outcomes || []).find((outcome) => outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
    || (selectedGroup?.outcomes || []).find((outcome) => outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
    || null
  );
  const bundleMarketId = ctx.bundle?.market?.id ?? ctx.bundle?.identity?.localMarketId ?? ctx.bundle?.identity?.marketId ?? ctx.bundle?.price?.marketId ?? ctx.bundle?.chart?.marketId ?? ctx.bundle?.lob?.marketId ?? null;
  const bundleMatchesSelected = ctx.selectedMarketId != null && bundleMarketId != null && Number(bundleMarketId) === Number(ctx.selectedMarketId);
  const selectedOutcomeMatches = selectedOutcome?.marketId != null && Number(selectedOutcome.marketId) === ctx.selectedMarketId;
  const selectedTokenId = String(selectedOutcome?.yesTokenId || '').trim();
  const selectedNoTokenId = String(selectedOutcome?.noTokenId || '').trim();
  const selectedTokenKey = selectedTokenId ? `${selectedTokenId}:${selectedNoTokenId}` : '';
  const [tokenLobState, setTokenLobState] = useState<{ key: string; lob: LobPayload | null; loading: boolean }>({
    key: '',
    lob: null,
    loading: false,
  });
  const tokenLob = tokenLobState.key === selectedTokenKey ? tokenLobState.lob : null;
  const tokenLobLoading = tokenLobState.key === selectedTokenKey && tokenLobState.loading;
  const executionAvailable = bundleMatchesSelected || selectedOutcomeMatches || Boolean(selectedTokenId) || Boolean(ctx.selectedMarketId && !detail);
  const chart = bundleMatchesSelected ? (ctx.bundle?.chart || null) : null;
  const price = executionAvailable && bundleMatchesSelected ? (ctx.bundle?.price ?? null) : null;
  const lob = executionAvailable ? (tokenLob || (bundleMatchesSelected ? ctx.bundle?.lob : null)) : null;
  const trades = executionAvailable && bundleMatchesSelected ? (ctx.bundle?.trades || []) : [];
  const marketStats = marketLookup(ctx.markets, ctx.selectedMarketId);
  const [bookSide, setBookSide] = useState<BookSide>('yes');
  const activeBook = bookSide === 'no' ? lob?.no : lob?.yes;
  const activePrice = bookSide === 'no'
    ? (price?.latestNoPrice ?? price?.latestPrice)
    : (price?.latestYesPrice ?? price?.latestPrice);
  const spreadValue = activeBook?.spread;
  const askLevels = activeBook?.asks || [];
  const bidLevels = activeBook?.bids || [];
  const askDepthTotal = bookDepthTotal(askLevels);
  const bidDepthTotal = bookDepthTotal(bidLevels);
  const hasAnyBookLevels = hasBookLevels(lob);
  const hasActiveBookLevels = hasSideBookLevels(activeBook);
  const eventOutcomes = detail ? eventOutcomeCards(detail) : [];
  const legacyOutcomes = detail ? [] : (outcomeCards(price) as LegacyOutcomeCard[]);
  const shouldShowOutcomeRail = detail
    ? (detail.outcomes || []).length > 1
    : ((selectedGroup?.outcomes || []).length > 1 || Number(marketStats?.outcomeCount || 2) > 2);
  const displayedYesPrice = selectedOutcome?.yesPrice ?? price?.latestYesPrice ?? price?.latestPrice ?? focusedMarket?.latestYesPrice ?? focusedMarket?.latestPrice;
  const displayedChange = selectedOutcome?.change24h ?? price?.change24h;
  const displayedVolume = selectedOutcome?.volume24h ?? price?.volume24h ?? marketStats?.volume24h;
  const displayedTrades = selectedOutcome?.tradeCount24h ?? price?.tradeCount24h ?? marketStats?.tradeCount24h;
  const displayedNoPrice = selectedOutcome?.noPrice ?? price?.latestNoPrice;
  const chartStatus = String(chart?.historyStatus || '').toLowerCase();
  const chartPointCount = chart?.points?.length || 0;
  const chartRenderable = Boolean(
    chart
      && chartPointCount > 2
      && chartStatus !== 'snapshot'
      && chartStatus !== 'missing',
  );
  const displayChart = chartRenderable ? chart : null;
  const chartPoints = displayChart?.points || [];
  const hasEventHistory = Boolean((eventChart?.series || []).some((entry) => (entry.points || []).length > 1));
  const hasSelectedEventHistory = Boolean((eventChart?.series || []).some((entry) => (
    (!ctx.selectedMarketGroupOutcomeKey || entry.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
      && (entry.points || []).length > 1
  )));
  const hasFocusedMarketHistory = Boolean(chartPoints.length);
  const showFocusedOutcomeFallback = Boolean(detail && !hasEventHistory && hasFocusedMarketHistory);
  const hasServingTradeActivity = Number(displayedTrades || 0) > 0 || Number(displayedVolume || 0) > 0;
  const liveQuoteAvailable = Boolean(
    hasAnyBookLevels
      || hasServingTradeActivity
      || hasSelectedEventHistory
      || hasFocusedMarketHistory,
  );
  const suppressTerminalSnapshot = Boolean(
    isTerminalProbability(displayedYesPrice)
      && !liveQuoteAvailable
  );
  const liveDisplayedYesPrice = safeLiveProbability(displayedYesPrice, !suppressTerminalSnapshot);
  const liveDisplayedNoPrice = safeLiveProbability(displayedNoPrice, !suppressTerminalSnapshot);
  const activePriceForBook = hasActiveBookLevels ? activePrice : null;
  const noTradesYet = executionAvailable && trades.length === 0 && !hasServingTradeActivity;
  const eventCategory = detail?.category || selectedGroup?.category || focusedMarket?.category || marketStats?.category || 'market';
  const outcomeCount = detail?.outcomeCount ?? selectedGroup?.outcomeCount ?? detail?.outcomes?.length ?? marketStats?.outcomeCount ?? null;
  const wrapPanel = (panelId: string, className: string, panel: ComponentChildren) => (
    renderPanelSlot ? renderPanelSlot(panelId, className, panel) : panel
  );

  useEffect(() => {
    if (!selectedTokenId) {
      setTokenLobState((current) => (current.loading || current.lob ? { key: '', lob: null, loading: false } : current));
      return;
    }
    let cancelled = false;
    const key = selectedTokenKey;
    setTokenLobState({ key, lob: null, loading: true });
    fetchMarketLobByToken(selectedTokenId, selectedOutcome?.label || detail?.title || '', selectedNoTokenId, 3500)
      .then((lobPayload) => {
        if (!cancelled) setTokenLobState({ key, lob: lobPayload, loading: false });
      })
      .catch(() => {
        if (!cancelled) setTokenLobState({ key, lob: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.title, selectedNoTokenId, selectedOutcome?.label, selectedTokenId, selectedTokenKey]);

  return (
    <section className="wm-focus-strip">
      {wrapPanel('price-chart', 'wm-focus-panel-slot wm-focus-detail-slot', (
        <Panel
          title="MARKET DETAIL"
          badge="selected ×"
          status="live"
          className="wm-focus-panel wm-focus-detail-panel"
        >
          <div className="wm-focus-detail">
            <div className="wm-focus-event-head">
              <div className="wm-focus-event-mark" aria-hidden="true">
                <span>{String(eventCategory || 'M').slice(0, 1).toUpperCase()}</span>
              </div>
              <div className="wm-focus-detail-copy">
                <div className="wm-focus-kicker">
                  <span>{eventCategory}</span>
                  <i>{outcomeCount ? `${outcomeCount} outcomes` : 'event'}</i>
                  <i>{marketTimeSubtitle(
                    detail?.endDate || selectedGroup?.endDate || focusedMarket?.endDate || null,
                    detail?.createdAt || selectedGroup?.createdAt || focusedMarket?.createdAt || marketStats?.createdAt || null,
                  )}</i>
                </div>
                <strong className="wm-focus-title">{detail?.title || selectedGroup?.title || focusedMarket?.title || 'No market selected.'}</strong>
              </div>
              <div className="wm-focus-price-hero">
                <strong>{formatPercent(liveDisplayedYesPrice)}</strong>
                <span className={suppressTerminalSnapshot ? 'flat' : signedClass(displayedChange)}>
                  {suppressTerminalSnapshot ? 'No live quote' : `${selectedOutcome?.label || 'Selected'} ${formatSignedPercent(displayedChange)}`}
                </span>
              </div>
            </div>

            <div className="wm-focus-chart-card">
              <div className="wm-focus-chart-topline">
                <div className="wm-focus-chart-tabs" aria-label="chart range">
                  <button type="button" className="ghost">Past</button>
                  {CHART_RANGE_TABS.map((tab) => (
                    <button
                      type="button"
                      key={tab.value}
                      className={ctx.selectedMarketGroupChartRange === tab.value ? 'active' : ''}
                      onClick={() => ctx.setSelectedMarketGroupChartRange(tab.value)}
                    >
                      {tab.label}
                    </button>
                  ))}
                  <i>UTC</i>
                </div>
                <div className="wm-focus-chart-summary">
                  <span>Vol <strong>{formatCurrencyCompact(displayedVolume)}</strong></span>
                  <span>24h <strong>{formatCompact(displayedTrades)}</strong></span>
                </div>
              </div>
              {detail ? eventChartLegend(detail, eventChart, ctx.selectedMarketGroupOutcomeKey, (outcome) => {
                ctx.setSelectedMarketGroupOutcomeKey(outcome.outcomeKey || null);
                if (outcome.marketId != null) {
                  ctx.setSelectedMarketId(Number(outcome.marketId));
                } else {
                  ctx.setSelectedMarketId(null);
                }
              }) : null}
              <div className={`wm-focus-detail-grid${shouldShowOutcomeRail ? '' : ' compact'}`}>
                <div className="wm-focus-chart-wrap">
                  {detail
                    ? (
                        hasEventHistory
                          ? renderEventDetailChart(eventChart, ctx.selectedMarketGroupOutcomeKey)
                          : showFocusedOutcomeFallback
                            ? renderDetailChart(displayChart)
                            : emptyState('No event price history is available for this market yet.')
                      )
                    : (chartPoints.length ? renderDetailChart(displayChart) : emptyState('No local price history is available for this market.'))}
                </div>
                {shouldShowOutcomeRail ? (
                  <aside className="wm-focus-outcome-rail" aria-label="outcomes">
                    {detail
                      ? eventOutcomes.map((outcome: EventOutcomeCard) => (
                          <button
                            type="button"
                            className={`wm-focus-outcome-card event ${outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey ? 'active' : ''} ${outcome.marketId == null ? 'pending' : ''}`}
                            key={outcome.outcomeKey || outcome.label || outcome.gammaMarketId || outcome.marketId}
                            onClick={() => {
                              ctx.setSelectedMarketGroupOutcomeKey(outcome.outcomeKey || null);
                              if (outcome.marketId != null) {
                                ctx.setSelectedMarketId(Number(outcome.marketId));
                              } else {
                                ctx.setSelectedMarketId(null);
                              }
                            }}
                          >
                            <div className="wm-focus-outcome-top">
                              <span>{outcome.label}</span>
                              <strong>{Number.isFinite(outcome.price) ? formatPercent(outcome.price) : '--'}</strong>
                            </div>
                            <div className={`wm-focus-outcome-change ${signedClass(outcome.change)}`}>
                              {Number.isFinite(outcome.change) ? formatSignedPercent(outcome.change) : '--'}
                            </div>
                            <div className="wm-focus-outcome-cta">
                              {outcome.marketId != null ? `Focus ${outcome.label}` : 'Pending local sync'}
                            </div>
                          </button>
                        ))
                      : legacyOutcomes.map((outcome) => (
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
              <span><em>Vol</em> {formatCurrencyCompact(displayedVolume)}</span>
              <span><em>24h</em> {formatCompact(displayedTrades)} trades</span>
              <span><em>Yes</em> {formatPercent(liveDisplayedYesPrice)}</span>
              <span><em>No</em> {formatPercent(liveDisplayedNoPrice)}</span>
            </div>
          </div>
        </Panel>
      ))}

      {wrapPanel('lob-depth', 'wm-focus-panel-slot wm-focus-book-slot', (
        <Panel
          title="ORDER BOOK"
          badge="live"
          status="live"
          className="wm-focus-panel wm-focus-book-panel"
          controls={(selectedOutcome || focusedMarket) ? <span className="wm-focus-header-note">{orderbookOutcomeLabel(ctx, bookSide, selectedOutcome)}</span> : undefined}
        >
          {!executionAvailable && detail ? (
            emptyState('Select an outcome with CLOB token data to inspect the order book.')
          ) : tokenLobLoading ? (
            emptyState('Loading live CLOB order book.')
          ) : !lob || !activeBook ? (
            emptyState('No CLOB order book snapshot is available for this market.')
          ) : !hasAnyBookLevels ? (
            emptyState('No live CLOB order book is available. This market may be newly listed, paused, closed, or not yet indexed locally.')
          ) : (
            <div className="wm-focus-book" key={`book-${bookSide}`}>
              <div className="wm-focus-book-topbar">
                <div className="wm-focus-book-tabs" aria-label="order book outcome">
                  <button type="button" className={bookSide === 'yes' ? 'active' : ''} onClick={() => setBookSide('yes')}>YES</button>
                  <button type="button" className={bookSide === 'no' ? 'active' : ''} onClick={() => setBookSide('no')}>NO</button>
                </div>
                <div className="wm-focus-book-market">
                  <span>Best Ask <strong className="ask">{formatBookPrice(activeBook?.bestAsk)}</strong></span>
                  <span>Best Bid <strong className="bid">{formatBookPrice(activeBook?.bestBid)}</strong></span>
                </div>
              </div>
              <div className="wm-focus-book-overview">
                <article className="wm-book-stat-spread">
                  <span>Spread</span>
                  <strong>{formatBookPrice(spreadValue)}</strong>
                </article>
                <article className="wm-book-stat-last">
                  <span>Last</span>
                  <strong>{formatBookPrice(activePriceForBook)}</strong>
                </article>
                <article className="wm-book-stat-depth">
                  <span>Top Depth</span>
                  <strong>{formatBookTotal(askDepthTotal + bidDepthTotal)}</strong>
                </article>
              </div>
              <div className="wm-focus-book-ladder">
                <div className="wm-focus-book-side ask">
                  <div className="wm-focus-book-side-head">
                    <strong>Asks</strong>
                    <span>{askLevels.length} levels · {formatBookTotal(askDepthTotal)}</span>
                  </div>
                  <div className="wm-focus-book-header">
                    <span>Price</span>
                    <span>Shares</span>
                    <span>Total</span>
                  </div>
                  <div className="wm-focus-book-rows">
                    {askLevels.length ? orderBookRows(askLevels, 'ask') : <div className="wm-focus-book-empty">No asks</div>}
                  </div>
                </div>
                <div className="wm-focus-book-mid" aria-label="order book spread">
                  <span>Mid Market</span>
                  <strong>{formatBookPrice(activePriceForBook)}</strong>
                  <em>Spread {formatBookPrice(spreadValue)}</em>
                </div>
                <div className="wm-focus-book-side bid">
                  <div className="wm-focus-book-side-head">
                    <strong>Bids</strong>
                    <span>{bidLevels.length} levels · {formatBookTotal(bidDepthTotal)}</span>
                  </div>
                  <div className="wm-focus-book-header">
                    <span>Price</span>
                    <span>Shares</span>
                    <span>Total</span>
                  </div>
                  <div className="wm-focus-book-rows">
                    {bidLevels.length ? orderBookRows(bidLevels, 'bid') : <div className="wm-focus-book-empty">No bids</div>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Panel>
      ))}

      {wrapPanel('global-orderfilled', 'wm-focus-panel-slot wm-focus-trades-slot', (
        <Panel
          title="ORDERFILLED FLOW"
          badge="FOCUSED"
          status="live"
          count={trades.length}
          className="wm-focus-panel wm-focus-trades-panel wm-orderfilled-panel"
          controls={(selectedOutcome || focusedMarket) ? <span className="wm-focus-header-note">{selectedOutcome?.label || focusedMarket?.title}</span> : undefined}
        >
          <div className="wm-focus-trades">
            <div className="wm-focus-trades-meta">
              <span>{trades[0]?.timestamp ? `latest ${formatRelative(trades[0].timestamp)}` : (hasServingTradeActivity ? 'summary only' : noTradesYet ? 'no trades yet' : 'waiting for trades')}</span>
              <strong>{trades[0] && tradeNotional(trades[0]) ? `$${formatCompact(tradeNotional(trades[0]))}` : '--'}</strong>
            </div>
            {!executionAvailable && detail
              ? emptyState('Select an outcome with local sync to inspect orderfilled flow.')
              : trades.length
              ? orderfilledList(trades, 12, (trade) => resolveMarketTitle(ctx, trade))
              : emptyState(hasServingTradeActivity ? 'Volume is available, but raw OrderFilled rows are not indexed locally yet.' : noTradesYet ? 'No orderfilled rows exist for this outcome yet.' : 'No local orderfilled rows are available for this market.')}
          </div>
        </Panel>
      ))}
    </section>
  );
}
