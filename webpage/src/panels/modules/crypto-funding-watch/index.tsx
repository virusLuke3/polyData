import { Panel } from '@/components/Panel';
import { fetchRuntimeCryptoFundingWatch } from '@/services/api';
import type { RuntimeCryptoFundingItem, RuntimeCryptoFundingPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function percentLabel(value?: number | null, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(digits)}%`;
}

function priceLabel(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  if (Math.abs(numeric) >= 1000) return `$${Math.round(numeric).toLocaleString('en-US')}`;
  return `$${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function markerLabel(item: RuntimeCryptoFundingItem) {
  if (item.tone === 'critical') return 'HOT';
  if (item.tone === 'warning') return 'HIGH';
  if (item.tone === 'negative') return 'NEG';
  return 'OK';
}

function sourceStatus(payload?: RuntimeCryptoFundingPayload | null) {
  if (!payload?.sources) return payload?.status || 'live';
  const states = Object.values(payload.sources);
  if (states.some((state) => state === 'error' || state === 'missing-url')) return 'degraded';
  if (states.every((state) => state === 'empty')) return 'empty';
  return payload.status || 'live';
}

function FundingCard({ item }: { item: RuntimeCryptoFundingItem }) {
  const tone = item.tone || 'neutral';
  const fundingRate = Number(item.fundingRatePercent);
  const annualized = Number(item.annualizedPercent);
  return (
    <article className={`wm-funding-card is-${tone}`} title={`${item.exchange || 'Exchange'} ${item.symbol || ''}`}>
      <div className="wm-funding-card-main">
        <div className="wm-funding-card-meta">
          <span className="wm-funding-card-dot" />
          <span>{item.exchange || 'EXCHANGE'}</span>
          <span>/</span>
          <span>{item.symbol || item.pair || '--'}</span>
          <span>/</span>
          <span>{formatRelative(item.nextFundingTime || null)}</span>
        </div>
        <div className="wm-funding-card-title">
          <strong>{item.asset || 'CRYPTO'}</strong>
          <span>{item.severity || 'normal'}</span>
        </div>
        <div className="wm-funding-card-bottom">
          <span className="wm-funding-card-primary">{percentLabel(fundingRate)}</span>
          <span className="wm-funding-card-secondary">{Number.isFinite(annualized) ? `${annualized > 0 ? '+' : ''}${annualized.toFixed(1)}% ann.` : '-- ann.'}</span>
          <span className="wm-funding-card-tertiary">{priceLabel(item.markPrice)}</span>
        </div>
      </div>
      <span className="wm-funding-card-marker" aria-hidden="true">{markerLabel(item)}</span>
    </article>
  );
}

function FundingList({ payload }: { payload?: RuntimeCryptoFundingPayload | null }) {
  const items = payload?.items || [];
  if (!items.length) {
    return (
      <div className="wm-empty-state">
        <strong>No funding rates loaded yet.</strong>
        <em>{sourceStatus(payload).toUpperCase()}</em>
      </div>
    );
  }
  return (
    <div className="wm-funding-list">
      {items.map((item) => <FundingCard key={item.id} item={item} />)}
    </div>
  );
}

const renderers: PanelRenderMap = {
  'crypto-funding-watch': {
    render: (ctx) => {
      const payload = ctx.runtimeData['crypto-funding-watch'] as RuntimeCryptoFundingPayload | undefined;
      const items = payload?.items || [];
      const degraded = sourceStatus(payload) !== 'ok' && sourceStatus(payload) !== 'live';
      return (
        <Panel
          title="FUNDING"
          badge={degraded ? 'STALE' : 'LIVE'}
          status="live"
          count={items.length}
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
  description: 'Binance and Bybit perpetual funding rates sorted by abnormality.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 60000,
  fetchData: () => fetchRuntimeCryptoFundingWatch(16),
});
