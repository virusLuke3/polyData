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

function sourceStatus(payload?: RuntimeCryptoFundingPayload | null) {
  if (!payload?.sources) return payload?.status || 'live';
  const states = Object.values(payload.sources);
  if (states.some((state) => state === 'error' || state === 'missing-url')) return 'degraded';
  if (states.every((state) => state === 'empty')) return 'empty';
  return payload.status || 'live';
}

function toneLabel(item: RuntimeCryptoFundingItem) {
  if (item.tone === 'critical') return 'Extreme';
  if (item.tone === 'warning') return 'Elevated';
  if (item.tone === 'negative') return 'Negative';
  return 'Normal';
}

function toneClass(item: RuntimeCryptoFundingItem) {
  if (item.tone === 'critical') return 'critical';
  if (item.tone === 'warning') return 'warning';
  if (item.tone === 'negative') return 'negative';
  if (item.tone === 'normal') return 'normal';
  return 'neutral';
}

function compactTimeLabel(value?: string | null) {
  if (!value) return '--';
  const relative = formatRelative(value);
  return relative.replace(' ago', '').replace('in ', '');
}

function uniqueAssets(items: RuntimeCryptoFundingItem[]) {
  return new Set(items.map((item) => item.asset || item.symbol || item.id)).size;
}

function marketExchangeMix(items: RuntimeCryptoFundingItem[]) {
  return new Set(items.map((item) => item.exchange || 'Exchange')).size;
}

function maxAbsFunding(items: RuntimeCryptoFundingItem[]) {
  const values = items
    .map((item) => Math.abs(Number(item.fundingRatePercent)))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return '--';
  return `${Math.max(...values).toFixed(3)}%`;
}

function pressureCount(items: RuntimeCryptoFundingItem[]) {
  return items.filter((item) => item.tone === 'critical' || item.tone === 'warning' || item.tone === 'negative').length;
}

function FundingSummary({ items }: { items: RuntimeCryptoFundingItem[] }) {
  return (
    <div className="wm-funding-summary-grid">
      <div className="wm-funding-summary-tile">
        <span className="wm-funding-summary-label">Assets</span>
        <strong className="wm-funding-summary-value">{uniqueAssets(items)}</strong>
      </div>
      <div className="wm-funding-summary-tile">
        <span className="wm-funding-summary-label">Venues</span>
        <strong className="wm-funding-summary-value">{marketExchangeMix(items)}</strong>
      </div>
      <div className="wm-funding-summary-tile">
        <span className="wm-funding-summary-label">Max Abs</span>
        <strong className="wm-funding-summary-value">{maxAbsFunding(items)}</strong>
      </div>
      <div className="wm-funding-summary-tile is-pressure">
        <span className="wm-funding-summary-label">Pressure</span>
        <strong className="wm-funding-summary-value">{pressureCount(items)}</strong>
      </div>
    </div>
  );
}

function FundingRow({ item, index }: { item: RuntimeCryptoFundingItem; index: number }) {
  const tone = toneClass(item);
  return (
    <article className={`wm-funding-row is-${tone}`} title={`${item.exchange || 'Exchange'} ${item.symbol || ''}`}>
      <div className="wm-funding-row-rank">{String(index + 1).padStart(2, '0')}</div>
      <div className="wm-funding-row-main">
        <div className="wm-funding-row-top">
          <div className="wm-funding-row-identity">
            <div className="wm-funding-row-symbol">{item.asset || item.symbol || 'CRYPTO'}</div>
            <div className="wm-funding-row-meta">
              <span>{item.exchange || 'Exchange'}</span>
              <span>{item.symbol || item.pair || '--'}</span>
            </div>
          </div>
          <span className={`wm-funding-tone-badge is-${tone}`}>{toneLabel(item)}</span>
        </div>
        <div className="wm-funding-row-metrics">
          <div className="wm-funding-row-metric is-rate">
            <span>Funding</span>
            <strong>{percentLabel(item.fundingRatePercent)}</strong>
          </div>
          <div className="wm-funding-row-metric is-annualized">
            <span>Annualized</span>
            <strong>{percentLabel(item.annualizedPercent, 1)}</strong>
          </div>
          <div className="wm-funding-row-metric">
            <span>Mark</span>
            <strong>{priceLabel(item.markPrice)}</strong>
          </div>
          <div className="wm-funding-row-metric">
            <span>Reset</span>
            <strong>{compactTimeLabel(item.nextFundingTime)}</strong>
          </div>
        </div>
      </div>
    </article>
  );
}

function FundingList({ payload }: { payload?: RuntimeCryptoFundingPayload | null }) {
  const items = payload?.items || [];
  if (!items.length) {
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
      <FundingSummary items={items} />
      <div className="wm-funding-table">
        <div className="wm-funding-section-head">
          <span>Perpetual Funding Pressure</span>
          <em>{sourceStatus(payload).toUpperCase()}</em>
        </div>
        <div className="wm-funding-table-body">
          {items.map((item, index) => <FundingRow key={item.id} item={item} index={index} />)}
        </div>
      </div>
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
