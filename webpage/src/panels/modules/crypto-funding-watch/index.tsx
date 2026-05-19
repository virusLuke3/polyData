import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeCryptoFundingWatch } from '@/services/api';
import type { RuntimeCryptoFundingAsset, RuntimeCryptoFundingItem, RuntimeCryptoFundingPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function absolutePercentLabel(value?: number | null, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${Math.abs(numeric).toFixed(digits)}%`;
}

function compactPercentLabel(value?: number | null, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const abs = Math.abs(numeric);
  const precision = abs >= 1 ? 1 : digits;
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(precision)}%`;
}

function sourceStatus(payload?: RuntimeCryptoFundingPayload | null) {
  if (!payload?.sources) return payload?.status || 'live';
  const states = Object.values(payload.sources);
  if (states.some((state) => state === 'error' || state === 'missing-url')) return 'degraded';
  if (states.every((state) => state === 'empty')) return 'empty';
  return payload.status || 'live';
}

function compactTimeLabel(value?: string | null) {
  if (!value) return '--';
  const relative = formatRelative(value);
  return relative.replace(' ago', '').replace('in ', '');
}

function groupedAssets(payload?: RuntimeCryptoFundingPayload | null): RuntimeCryptoFundingAsset[] {
  return payload?.assets || [];
}

function venueCount(payload: RuntimeCryptoFundingPayload | null | undefined, assets: RuntimeCryptoFundingAsset[]) {
  if (payload?.venues?.length) return payload.venues.length;
  return new Set(
    assets.flatMap((asset) => asset.quotes || []).map((quote) => quote.exchange || 'Exchange'),
  ).size;
}

function countByBias(assets: RuntimeCryptoFundingAsset[], bias: string) {
  return assets.filter((asset) => asset.bias === bias).length;
}

function maxAbsFundingValue(assets: RuntimeCryptoFundingAsset[]) {
  const values = assets
    .map((asset) => Math.abs(Number(asset.maxAbsFundingPercent)))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return '--';
  return absolutePercentLabel(Math.max(...values), 3);
}

function biasLabel(asset: RuntimeCryptoFundingAsset) {
  if (asset.bias === 'longs-pay') return 'Longs Pay';
  if (asset.bias === 'shorts-pay') return 'Shorts Pay';
  if (asset.bias === 'mixed') return 'Mixed';
  return 'Flat';
}

function quoteDirectionLabel(quote: RuntimeCryptoFundingItem) {
  if (quote.direction === 'positive') return 'Longs Pay';
  if (quote.direction === 'negative') return 'Shorts Pay';
  return 'Flat';
}

function orderQuotes(asset: RuntimeCryptoFundingAsset, payload?: RuntimeCryptoFundingPayload | null) {
  const venueOrder = payload?.venues || [];
  return [...(asset.quotes || [])].sort((left, right) => {
    const leftIndex = venueOrder.indexOf(left.exchange || 'Exchange');
    const rightIndex = venueOrder.indexOf(right.exchange || 'Exchange');
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });
}

function isResetSoon(value?: string | null) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const diffMs = timestamp - Date.now();
  return diffMs > 0 && diffMs <= 2 * 60 * 60 * 1000;
}

function nearestResetLabel(assets: RuntimeCryptoFundingAsset[]) {
  const nearest = assets
    .map((asset) => asset.nextFundingTime)
    .filter(Boolean)
    .map((value) => ({ value, timestamp: Date.parse(String(value)) }))
    .filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp > Date.now())
    .sort((left, right) => left.timestamp - right.timestamp)[0];
  return nearest ? `${compactTimeLabel(nearest.value)} reset` : '--';
}

function fundingPressureStats(payload: RuntimeCryptoFundingPayload | null | undefined, assets: RuntimeCryptoFundingAsset[]) {
  const longs = countByBias(assets, 'longs-pay');
  const shorts = countByBias(assets, 'shorts-pay');
  const mixed = countByBias(assets, 'mixed');
  const alertCount = assets.filter((asset) => {
    const maxAbs = Math.abs(Number(asset.maxAbsFundingPercent));
    return asset.tone === 'critical' || asset.tone === 'warning' || maxAbs >= 0.008;
  }).length;
  const topAsset = [...assets]
    .sort((left, right) => Math.abs(Number(right.maxAbsFundingPercent)) - Math.abs(Number(left.maxAbsFundingPercent)))[0];
  const venueTotal = venueCount(payload, assets);

  if (shorts > longs && shorts >= mixed) {
    return {
      label: 'SHORT CROWDING',
      badge: 'SHORTS PAY',
      tone: 'shorts',
      subline: `${shorts} shorts pay / ${longs} longs pay / ${mixed} mixed`,
      alertCount,
      topAsset,
      venueTotal,
    };
  }

  if (longs > shorts && longs >= mixed) {
    return {
      label: 'LONG CROWDING',
      badge: 'LONGS PAY',
      tone: 'longs',
      subline: `${longs} longs pay / ${shorts} shorts pay / ${mixed} mixed`,
      alertCount,
      topAsset,
      venueTotal,
    };
  }

  return {
    label: 'MIXED FUNDING',
    badge: 'MIXED',
    tone: 'mixed',
    subline: `${mixed} mixed / ${longs} longs pay / ${shorts} shorts pay`,
    alertCount,
    topAsset,
    venueTotal,
  };
}

function fundingAssetTags(asset: RuntimeCryptoFundingAsset) {
  const tags = [{ label: biasLabel(asset).toUpperCase(), className: `bias-${asset.bias || 'flat'}` }];
  const maxAbs = Math.abs(Number(asset.maxAbsFundingPercent));
  const spread = Math.abs(Number(asset.spreadPercent));
  if (maxAbs >= 0.015 || asset.tone === 'critical') {
    tags.push({ label: 'EXTREME', className: 'severity-critical' });
  } else if (maxAbs >= 0.008 || asset.tone === 'warning') {
    tags.push({ label: 'WATCH', className: 'severity-warning' });
  }
  if (spread >= 0.01) {
    tags.push({ label: 'DIVERGENCE', className: 'severity-divergence' });
  }
  if (isResetSoon(asset.nextFundingTime)) {
    tags.push({ label: 'RESET SOON', className: 'severity-reset' });
  }
  return tags.slice(0, 4);
}

function FundingSummary({ payload, assets }: { payload?: RuntimeCryptoFundingPayload | null; assets: RuntimeCryptoFundingAsset[] }) {
  const stats = fundingPressureStats(payload, assets);
  const topAssetName = stats.topAsset?.asset || stats.topAsset?.symbol || 'watchlist';
  return (
    <section className={`wm-funding-hero tone-${stats.tone}`}>
      <div className="wm-funding-hero-main">
        <span className="wm-funding-hero-kicker">Market Pressure</span>
        <strong className="wm-funding-hero-title">{stats.label}</strong>
        <span className="wm-funding-hero-sub">{stats.subline}</span>
      </div>
      <div className="wm-funding-hero-side">
        <span className="wm-funding-hero-badge">{stats.badge}</span>
        <strong>{maxAbsFundingValue(assets)}</strong>
        <em>max abs</em>
      </div>
      <div className="wm-funding-stat-strip">
        <span>
          <strong>{assets.length}</strong>
          assets
        </span>
        <span>
          <strong>{stats.venueTotal}</strong>
          venues
        </span>
        <span>
          <strong>{stats.alertCount}</strong>
          alerts
        </span>
        <span>
          <strong>{nearestResetLabel(assets)}</strong>
          next
        </span>
        <span>
          <strong>{topAssetName}</strong>
          top move
        </span>
      </div>
    </section>
  );
}

function FundingVenuePill({ quote }: { quote: RuntimeCryptoFundingItem }) {
  const direction = quote.direction || 'flat';
  const tone = quote.tone || 'normal';
  const heat = quote.heatBand || 'flat';
  return (
    <article className={`wm-funding-venue-pill dir-${direction} tone-${tone} heat-${heat}`}>
      <div className="wm-funding-venue-head">
        <span>{quote.exchange || 'Exchange'}</span>
        <em>{compactTimeLabel(quote.nextFundingTime)}</em>
      </div>
      <strong className="wm-funding-venue-rate">{compactPercentLabel(quote.fundingRatePercent)}</strong>
      <div className="wm-funding-venue-sub">
        <span>{quoteDirectionLabel(quote)}</span>
        <span>{compactPercentLabel(quote.annualizedPercent, 1)} ann</span>
      </div>
    </article>
  );
}

function FundingRow({ asset, index, payload }: { asset: RuntimeCryptoFundingAsset; index: number; payload?: RuntimeCryptoFundingPayload | null }) {
  const bias = asset.bias || 'flat';
  const tone = asset.tone || 'normal';
  const tags = fundingAssetTags(asset);
  const quotes = orderQuotes(asset, payload);
  return (
    <article className={`wm-funding-asset-row bias-${bias} tone-${tone}`}>
      <div className="wm-funding-row-rank">{String(index + 1).padStart(2, '0')}</div>
      <div className="wm-funding-row-main">
        <div className="wm-funding-row-top">
          <div className="wm-funding-row-identity">
            <div className="wm-funding-row-symbol">{asset.asset || asset.symbol || 'CRYPTO'}</div>
            <div className="wm-funding-row-meta">
              <span>{asset.venues || quotes.length} venues</span>
              <span>{compactPercentLabel(asset.consensusFundingPercent)} avg</span>
              <span>{absolutePercentLabel(asset.spreadPercent, 3)} spread</span>
              <span>{compactTimeLabel(asset.nextFundingTime)} reset</span>
            </div>
          </div>
          <div className="wm-funding-row-signal">
            <strong>{compactPercentLabel(asset.maxAbsFundingPercent)}</strong>
            <span>max</span>
          </div>
        </div>
        <div className="wm-funding-row-tags">
          {tags.map((tag) => (
            <span key={`${asset.id}-${tag.label}`} className={`wm-funding-row-tag ${tag.className}`}>{tag.label}</span>
          ))}
        </div>
        <div className="wm-funding-venue-strip">
          {quotes.map((quote) => (
            <FundingVenuePill key={quote.id} quote={quote} />
          ))}
        </div>
      </div>
    </article>
  );
}

function FundingList({ payload }: { payload?: RuntimeCryptoFundingPayload | null }) {
  const assets = groupedAssets(payload);
  if (!assets.length) {
    return (
      <div className="wm-funding-empty-state">
        <span>Standby</span>
        <strong>No funding rates loaded yet.</strong>
        <em>{sourceStatus(payload).toUpperCase()}</em>
      </div>
    );
  }
  return (
    <div className="wm-funding-monitor">
      <FundingSummary payload={payload} assets={assets} />
      <div className="wm-funding-table">
        <div className="wm-funding-table-body">
          {assets.map((asset, index) => <FundingRow key={asset.id} asset={asset} index={index} payload={payload} />)}
        </div>
      </div>
    </div>
  );
}

function FundingRatePanel({ payload }: { payload?: RuntimeCryptoFundingPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const assets = payload?.assets || [];
  const degraded = sourceStatus(payload) !== 'ok' && sourceStatus(payload) !== 'live';
  const stats = fundingPressureStats(payload, assets);

  return (
    <Panel
      title="FUNDING RATE"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain perpetual funding rate"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={degraded ? 'STALE' : assets.length ? stats.badge : 'LIVE'}
      status="live"
      count={assets.length ? stats.alertCount || assets.length : 0}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Funding Rate</strong>
          <p>Perpetual funding keeps perp prices anchored near spot. Positive funding means longs pay shorts. Negative funding means shorts pay longs.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-funding-panel"
    >
      <FundingList payload={payload} />
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'crypto-funding-watch': {
    render: (ctx) => {
      const payload = ctx.runtimeData['crypto-funding-watch'] as RuntimeCryptoFundingPayload | undefined;
      return <FundingRatePanel payload={payload} />;
    },
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'crypto-funding-watch',
  title: 'Crypto Funding Watch',
  eyebrow: 'macro',
  description: 'Cross-venue perpetual funding heatmap with long/short crowding bias.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 15000,
  fetchData: () => fetchRuntimeCryptoFundingWatch(18),
});
