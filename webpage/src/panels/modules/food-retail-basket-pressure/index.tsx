import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFoodRetailBasket } from '@/services/api';
import type { RuntimeFoodBasketItem, RuntimeFoodRetailBasketPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'FRED';
  if (normalized === 'degraded') return 'PARTIAL';
  return 'WARMING';
}

function panelTone(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

function pctLabel(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function indexLabel(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(1);
}

function toneClass(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'flat';
  if (n >= 0.35) return 'hot';
  if (n <= -0.2) return 'cool';
  return 'flat';
}

function componentCode(item: RuntimeFoodBasketItem) {
  const key = String(item.key || '').toLowerCase();
  if (key === 'food') return 'FOOD';
  if (key === 'home') return 'HOME';
  if (key === 'meat_eggs') return 'MEAT';
  if (key === 'fruit_veg') return 'F/V';
  if (key === 'eggs') return 'EGGS';
  return String(item.seriesId || 'CPI').slice(0, 8).toUpperCase();
}

function FoodBasketRow({ item }: { item: RuntimeFoodBasketItem }) {
  return (
    <div className={`wm-food-basket-row ${toneClass(item.momPct)}`}>
      <div>
        <span>{componentCode(item)}</span>
        <strong>{item.label || 'Food CPI component'}</strong>
      </div>
      <strong>{pctLabel(item.momPct)}</strong>
      <em>{pctLabel(item.yoyPct)} Y</em>
    </div>
  );
}

function FoodRetailBasketPanel({ payload }: { payload?: RuntimeFoodRetailBasketPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const summary = payload?.summary;
  const items = payload?.items || [];
  const topMover = summary?.topMover;
  return (
    <Panel
      title="FOOD / RETAIL"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain food basket data source"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={badgeLabel(payload?.status)}
      status={panelTone(payload?.status)}
      count={items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Food Basket Pressure</strong>
          <p>Uses free official FRED/BLS CPI food components as a seed-first pressure gauge. It is not a live retailer price scraper, so it is best for CPI basket direction and Polymarket macro context.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-food-basket-panel"
      dataPanelId="food-retail-basket-pressure"
    >
      <div className={`wm-food-basket-hero ${summary?.bias || 'neutral'}`}>
        <div>
          <span>Signal</span>
          <strong>{summary?.signal || 'FOOD WARMING'}</strong>
        </div>
        <div>
          <span>Pressure</span>
          <strong>{pctLabel(summary?.pressureScore)}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{summary?.coverage ?? items.length}</strong>
        </div>
      </div>
      <div className="wm-food-basket-top">
        <span>Top mover</span>
        <strong>{topMover?.label || 'Awaiting CPI component data'}</strong>
        <em>{topMover ? `${pctLabel(topMover.momPct)} MoM / ${indexLabel(topMover.value)} idx` : '--'}</em>
      </div>
      {items.length ? (
        <div className="wm-food-basket-grid">
          {items.map((item) => <FoodBasketRow key={item.key || item.seriesId || item.label || 'food'} item={item} />)}
        </div>
      ) : (
        <div className="wm-empty-state">
          <strong>Food basket snapshot warming.</strong>
          <em>FRED/BLS component data has not been seeded yet.</em>
        </div>
      )}
      <div className="wm-food-basket-footer">
        <span>{(payload?.cacheMode || 'snapshot').toUpperCase()}</span>
        <span>{(payload?.status || 'warming').toUpperCase()}</span>
        <span>{formatRelative(payload?.generatedAt)}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'food-retail-basket-pressure': {
    render: (ctx) => <FoodRetailBasketPanel payload={ctx.runtimeData['food-retail-basket-pressure'] as RuntimeFoodRetailBasketPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'food-retail-basket-pressure',
  title: 'Food & Retail Basket Pressure',
  eyebrow: 'macro',
  description: 'Official CPI food-component pressure for inflation market positioning.',
  defaultEnabled: true,
  size: 'tall',
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeFoodRetailBasket(8),
});
