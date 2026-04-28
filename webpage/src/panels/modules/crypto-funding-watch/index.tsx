import { Panel } from '@/components/Panel';
import { fetchRuntimeCryptoFundingWatch } from '@/services/api';
import type { RuntimeCryptoFundingAsset, RuntimeCryptoFundingItem, RuntimeCryptoFundingPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function percentLabel(value?: number | null, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(digits)}%`;
}

function absolutePercentLabel(value?: number | null, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${Math.abs(numeric).toFixed(digits)}%`;
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

function maxAbsFunding(assets: RuntimeCryptoFundingAsset[]) {
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

function directionLegend(payload?: RuntimeCryptoFundingPayload | null) {
  const positive = payload?.legend?.positive || 'longs pay shorts';
  const negative = payload?.legend?.negative || 'shorts pay longs';
  return `+ ${positive} / - ${negative}`;
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

function FundingSummary({ payload, assets }: { payload?: RuntimeCryptoFundingPayload | null; assets: RuntimeCryptoFundingAsset[] }) {
  return (
    <div className="wm-funding-summary-grid">
      <div className="wm-funding-summary-tile">
        <span className="wm-funding-summary-label">Assets</span>
        <strong className="wm-funding-summary-value">{assets.length}</strong>
      </div>
      <div className="wm-funding-summary-tile">
        <span className="wm-funding-summary-label">Venues</span>
        <strong className="wm-funding-summary-value">{venueCount(payload, assets)}</strong>
      </div>
      <div className="wm-funding-summary-tile is-long">
        <span className="wm-funding-summary-label">Longs Pay</span>
        <strong className="wm-funding-summary-value">{countByBias(assets, 'longs-pay')}</strong>
      </div>
      <div className="wm-funding-summary-tile is-short">
        <span className="wm-funding-summary-label">Shorts Pay</span>
        <strong className="wm-funding-summary-value">{countByBias(assets, 'shorts-pay')}</strong>
      </div>
      <div className="wm-funding-summary-tile is-heat">
        <span className="wm-funding-summary-label">Max Abs</span>
        <strong className="wm-funding-summary-value">{maxAbsFunding(assets)}</strong>
      </div>
      <div className="wm-funding-summary-tile is-mixed">
        <span className="wm-funding-summary-label">Mixed</span>
        <strong className="wm-funding-summary-value">{countByBias(assets, 'mixed')}</strong>
      </div>
    </div>
  );
}

function FundingVenueCard({ quote }: { quote: RuntimeCryptoFundingItem }) {
  const direction = quote.direction || 'flat';
  const tone = quote.tone || 'normal';
  const heat = quote.heatBand || 'flat';
  return (
    <article className={`wm-funding-venue-card dir-${direction} tone-${tone} heat-${heat}`}>
      <div className="wm-funding-venue-head">
        <span>{quote.exchange || 'Exchange'}</span>
        <em>{quoteDirectionLabel(quote)}</em>
      </div>
      <strong className="wm-funding-venue-rate">{percentLabel(quote.fundingRatePercent)}</strong>
      <div className="wm-funding-venue-sub">
        <span>{percentLabel(quote.annualizedPercent, 1)} ann.</span>
        <span>{compactTimeLabel(quote.nextFundingTime)}</span>
      </div>
    </article>
  );
}

function FundingRow({ asset, index, payload }: { asset: RuntimeCryptoFundingAsset; index: number; payload?: RuntimeCryptoFundingPayload | null }) {
  const bias = asset.bias || 'flat';
  const tone = asset.tone || 'normal';
  return (
    <article className={`wm-funding-asset-row bias-${bias} tone-${tone}`}>
      <div className="wm-funding-row-rank">{String(index + 1).padStart(2, '0')}</div>
      <div className="wm-funding-row-main">
        <div className="wm-funding-row-top">
          <div className="wm-funding-row-identity">
            <div className="wm-funding-row-symbol">{asset.asset || asset.symbol || 'CRYPTO'}</div>
            <div className="wm-funding-row-meta">
              <span>{asset.venues || asset.quotes.length} venues</span>
              <span>{percentLabel(asset.consensusFundingPercent)} avg</span>
              <span>{absolutePercentLabel(asset.spreadPercent)} spread</span>
              <span>{compactTimeLabel(asset.nextFundingTime)} reset</span>
            </div>
          </div>
          <span className={`wm-funding-bias-badge bias-${bias} tone-${tone}`}>{biasLabel(asset)}</span>
        </div>
        <div className="wm-funding-venue-grid">
          {orderQuotes(asset, payload).map((quote) => (
            <FundingVenueCard key={quote.id} quote={quote} />
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
        <div className="wm-funding-section-head">
          <div className="wm-funding-section-copy">
            <span>Perpetual Funding Map</span>
            <small>{directionLegend(payload)}</small>
          </div>
          <em>{sourceStatus(payload).toUpperCase()}</em>
        </div>
        <div className="wm-funding-table-body">
          {assets.map((asset, index) => <FundingRow key={asset.id} asset={asset} index={index} payload={payload} />)}
        </div>
      </div>
    </div>
  );
}

const renderers: PanelRenderMap = {
  'crypto-funding-watch': {
    render: (ctx) => {
      const payload = ctx.runtimeData['crypto-funding-watch'] as RuntimeCryptoFundingPayload | undefined;
      const assets = payload?.assets || [];
      const degraded = sourceStatus(payload) !== 'ok' && sourceStatus(payload) !== 'live';
      return (
        <Panel
          title="FUNDING"
          badge={degraded ? 'STALE' : 'LIVE'}
          status="live"
          count={assets.length}
          className="wm-market-panel wm-funding-panel"
        >
          <FundingList payload={payload} />
        </Panel>
      );
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
  fetchData: () => fetchRuntimeCryptoFundingWatch(10),
});
