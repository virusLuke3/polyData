import { Panel } from '@/components/Panel';
import { fetchRuntimeEnergyGasolineShock } from '@/services/api';
import type { RuntimeEnergyGasolineShockPayload, RuntimeEnergyShockItem } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function badge(status?: string | null) {
  return String(status || '').toLowerCase() === 'ok' ? 'EIA' : 'PARTIAL';
}

function valueLabel(item?: RuntimeEnergyShockItem) {
  const n = Number(item?.value);
  if (!Number.isFinite(n)) return '--';
  return item?.unit === '$/bbl' ? n.toFixed(2) : n.toFixed(3);
}

function changeLabel(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

function itemTone(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'flat';
  return n > 0 ? 'hot' : n < 0 ? 'cool' : 'flat';
}

function EnergyRow({ item }: { item: RuntimeEnergyShockItem }) {
  return (
    <div className={`wm-energy-row ${itemTone(item.changeWeek)}`}>
      <div>
        <span>{String(item.key || '').toUpperCase()}</span>
        <strong>{item.label}</strong>
      </div>
      <strong>{valueLabel(item)}</strong>
      <em>{changeLabel(item.changeWeek)} W</em>
    </div>
  );
}

function EnergyGasolineShockPanel({ payload }: { payload?: RuntimeEnergyGasolineShockPayload | null }) {
  const summary = payload?.summary;
  const items = payload?.items || [];
  return (
    <Panel
      title="ENERGY / GAS"
      badge={badge(payload?.status)}
      status={payload?.status === 'ok' ? 'live' : 'muted'}
      count={items.length}
      className="wm-market-panel wm-energy-shock-panel"
      dataPanelId="energy-gasoline-shock"
    >
      <div className={`wm-energy-hero ${summary?.bias || 'neutral'}`}>
        <span>Signal</span>
        <strong>{summary?.signal || 'ENERGY WARMING'}</strong>
        <em>CPI impulse {summary?.headlineImpulsePp ?? '--'}pp</em>
      </div>
      <div className="wm-energy-grid">
        {items.map((item) => <EnergyRow key={item.key || item.label || 'energy'} item={item} />)}
      </div>
      <div className="wm-energy-links">
        {(summary?.linkedMarkets || ['CPI headline', 'oil', 'Fed']).slice(0, 4).map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="wm-energy-footer">
        <span>{(payload?.cacheMode || 'snapshot').toUpperCase()}</span>
        <span>{formatRelative(payload?.generatedAt)}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'energy-gasoline-shock': {
    render: (ctx) => <EnergyGasolineShockPanel payload={ctx.runtimeData['energy-gasoline-shock'] as RuntimeEnergyGasolineShockPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'energy-gasoline-shock',
  title: 'Energy & Gasoline Shock',
  eyebrow: 'macro',
  description: 'EIA WTI, gasoline, and diesel pressure for headline CPI markets.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeEnergyGasolineShock(6),
});
