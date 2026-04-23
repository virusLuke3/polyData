import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { PanelRenderContext, RuntimeMarketGroup, RuntimeMarketTicker } from '@/types';
import type { PanelRenderMap } from './types';
import { emptyState } from './shared/renderers';

type CommoditiesTab = 'commodities' | 'fx';

const COMMODITY_SYMBOL_ORDER = [
  '^VIX',
  'GC=F',
  'SI=F',
  'HG=F',
  'PL=F',
  'PA=F',
  'ALI=F',
  'CL=F',
  'BZ=F',
  'NG=F',
  'TTF=F',
  'RB=F',
  'HO=F',
  'URA',
  'LIT',
  'MTF=F',
  'ZW=F',
  'ZC=F',
  'ZS=F',
  'ZR=F',
  'KC=F',
  'SB=F',
  'CC=F',
  'CT=F',
] as const;

const FX_SYMBOL_ORDER = [
  'EURUSD=X',
  'GBPUSD=X',
  'USDJPY=X',
  'USDCNY=X',
  'USDINR=X',
  'AUDUSD=X',
  'USDCHF=X',
  'USDCAD=X',
  'USDTRY=X',
] as const;

const COMMODITY_SORT_INDEX = new Map(COMMODITY_SYMBOL_ORDER.map((symbol, index) => [symbol, index]));
const FX_SORT_INDEX = new Map(FX_SYMBOL_ORDER.map((symbol, index) => [symbol, index]));
const CRYPTO_SYMBOL_ORDER = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'BNB-USD',
  'XRP-USD',
  'DOGE-USD',
  'ADA-USD',
  'AVAX-USD',
  'LINK-USD',
  'LTC-USD',
  'DOT-USD',
  'TRX-USD',
  'BCH-USD',
] as const;

const CRYPTO_SORT_INDEX = new Map(CRYPTO_SYMBOL_ORDER.map((symbol, index) => [symbol, index]));
type CryptoTickDirection = 'tick-up' | 'tick-down';

function isFxTicker(item: RuntimeMarketTicker) {
  return item.symbol.endsWith('=X');
}

function sortTickers(items: RuntimeMarketTicker[], sortIndex: Map<string, number>) {
  return [...items].sort((left, right) => {
    const leftIndex = sortIndex.get(left.symbol) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = sortIndex.get(right.symbol) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.label.localeCompare(right.label);
  });
}

function formatCryptoPrice(item: RuntimeMarketTicker) {
  if (item.price == null || !Number.isFinite(Number(item.price))) return '--';
  const numeric = Number(item.price);
  if (Math.abs(numeric) >= 1000) {
    return `$${Math.round(numeric).toLocaleString('en-US')}`;
  }
  const digits = numeric >= 100 ? 2 : numeric >= 1 ? 2 : 4;
  return `$${numeric.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function cryptoBoard(
  items: RuntimeMarketTicker[],
  emptyMessage: string,
  tickDirections: Record<string, CryptoTickDirection | undefined>,
) {
  if (!items.length) return emptyState(emptyMessage);
  return (
    <div className="wm-crypto-market-grid">
      {items.map((item) => {
        const changePercent = Number(item.changePercent);
        const tone = !Number.isFinite(changePercent) || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
        const sparkColor = tone === 'down' ? '#cb8d92' : tone === 'up' ? '#55e18a' : '#8f8f8c';
        const tickDirection = tickDirections[item.symbol];
        return (
          <article className={`wm-crypto-market-card ${tone}${tickDirection ? ` ${tickDirection}` : ''}`} key={item.symbol}>
            <div className="wm-crypto-market-name">{item.label}</div>
            <div className="wm-crypto-market-spark">{commoditySparkline(item.points, sparkColor)}</div>
            <div className="wm-crypto-market-price">{formatCryptoPrice(item)}</div>
            <div className={`wm-crypto-market-change ${tone}`}>{formatCommodityChange(item.changePercent)}</div>
          </article>
        );
      })}
    </div>
  );
}

function CryptoWatchPanel({ crypto }: { crypto?: RuntimeMarketGroup | null }) {
  const items = sortTickers(crypto?.items || [], CRYPTO_SORT_INDEX);
  const previousPricesRef = useRef<Record<string, number>>({});
  const clearTickTimerRef = useRef<number | null>(null);
  const [tickDirections, setTickDirections] = useState<Record<string, CryptoTickDirection | undefined>>({});

  useEffect(() => {
    const nextPrices: Record<string, number> = {};
    const nextDirections: Record<string, CryptoTickDirection | undefined> = {};

    items.forEach((item) => {
      const numeric = Number(item.price);
      if (!Number.isFinite(numeric)) return;
      nextPrices[item.symbol] = numeric;
      const previous = previousPricesRef.current[item.symbol];
      if (typeof previous === 'number' && Number.isFinite(previous) && previous !== numeric) {
        nextDirections[item.symbol] = numeric > previous ? 'tick-up' : 'tick-down';
      }
    });

    previousPricesRef.current = nextPrices;

    if (!Object.keys(nextDirections).length) return;
    setTickDirections(nextDirections);

    if (clearTickTimerRef.current !== null) {
      window.clearTimeout(clearTickTimerRef.current);
    }
    clearTickTimerRef.current = window.setTimeout(() => {
      setTickDirections({});
      clearTickTimerRef.current = null;
    }, 1200);

    return undefined;
  }, [items]);

  useEffect(() => () => {
    if (clearTickTimerRef.current !== null) {
      window.clearTimeout(clearTickTimerRef.current);
    }
  }, []);

  return (
    <Panel title="CRYPTO" badge="LIVE" status="live" count={items.length} className="wm-market-panel wm-crypto-market-panel">
      {cryptoBoard(items, 'No crypto prices loaded yet.', tickDirections)}
    </Panel>
  );
}

function commoditySparkline(points: RuntimeMarketTicker['points'], color: string) {
  const clean = (points || [])
    .map((point, index) => ({ index, value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.value));
  if (clean.length < 2) return null;

  const width = 60;
  const height = 18;
  const min = Math.min(...clean.map((point) => point.value));
  const max = Math.max(...clean.map((point) => point.value));
  const span = max - min || 1;
  const path = clean
    .map((point, index) => {
      const x = (point.index / Math.max(clean.length - 1, 1)) * width;
      const y = height - ((point.value - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mini-sparkline" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function formatCommodityPrice(item: RuntimeMarketTicker) {
  if (item.price == null || !Number.isFinite(Number(item.price))) return '--';
  const numeric = Number(item.price);
  if (isFxTicker(item)) {
    return numeric.toFixed(4);
  }
  if (Math.abs(numeric) >= 1000) {
    return `$${Math.round(numeric).toLocaleString('en-US')}`;
  }
  return `$${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCommodityChange(changePercent?: number | null) {
  if (changePercent == null || !Number.isFinite(Number(changePercent))) return '--';
  const numeric = Number(changePercent);
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function commodityBoard(items: RuntimeMarketTicker[], emptyMessage: string) {
  if (!items.length) {
    return (
      <div className="wm-commodity-empty">
        <span>{emptyMessage}</span>
      </div>
    );
  }
  return (
    <div className="commodities-grid">
      {items.map((item) => {
        const changePercent = Number(item.changePercent);
        const tone = !Number.isFinite(changePercent) || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
        const sparkColor = tone === 'down' ? '#ff6464' : '#39ff73';
        return (
          <div className="commodity-item" key={item.symbol}>
            <div className="commodity-name">{item.label}</div>
            {commoditySparkline(item.points, sparkColor)}
            <div className="commodity-price">{formatCommodityPrice(item)}</div>
            <div className={`commodity-change ${tone === 'flat' ? 'up' : tone}`}>{formatCommodityChange(item.changePercent)}</div>
          </div>
        );
      })}
    </div>
  );
}

function CommoditiesWatchPanel({ commodities }: { commodities?: RuntimeMarketGroup | null }) {
  const [tab, setTab] = useState<CommoditiesTab>('commodities');

  const tabItems = useMemo(() => {
    const items = commodities?.items || [];
    const commodityItems = sortTickers(items.filter((item) => !isFxTicker(item)), COMMODITY_SORT_INDEX);
    const fxItems = sortTickers(items.filter((item) => isFxTicker(item)), FX_SORT_INDEX);
    return { commodities: commodityItems, fx: fxItems };
  }, [commodities]);

  const hasFx = tabItems.fx.length > 0;
  const safeTab = tab === 'fx' && !hasFx ? 'commodities' : tab;
  const visibleItems = safeTab === 'fx' ? tabItems.fx : tabItems.commodities;

  return (
    <Panel
      title="COMMODITIES"
      badge="MACRO"
      status="live"
      count={visibleItems.length}
      className="wm-market-panel wm-commodities-panel"
    >
      <div className="wm-commodity-panel-stack">
        <div className="wm-commodity-tabbar" role="tablist" aria-label="Commodity market views">
          <button
            type="button"
            className={`panel-tab${safeTab === 'commodities' ? ' active' : ''}`}
            onClick={() => setTab('commodities')}
            role="tab"
            aria-selected={safeTab === 'commodities'}
          >
            Commodities
          </button>
          {hasFx ? (
            <button
              type="button"
              className={`panel-tab${safeTab === 'fx' ? ' active' : ''}`}
              onClick={() => setTab('fx')}
              role="tab"
              aria-selected={safeTab === 'fx'}
            >
              EUR FX
            </button>
          ) : null}
        </div>
        {commodityBoard(
          visibleItems,
          safeTab === 'fx' ? 'No FX quotes loaded yet.' : 'No commodity quotes loaded yet.',
        )}
      </div>
    </Panel>
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


export const macroPanelRenderers: PanelRenderMap = {
  'commodities-watch': {
    render: (ctx) => <CommoditiesWatchPanel commodities={ctx.commodities} />,
  },
  'crypto-watch': {
    render: (ctx) => <CryptoWatchPanel crypto={ctx.crypto} />,
  },
  'inflation-nowcast': {
    render: (ctx) => (
      <Panel title="INFLATION NOWCAST" badge="FED" status="live">
        {inflationNowcastPanel(ctx)}
      </Panel>
    ),
  },
};
