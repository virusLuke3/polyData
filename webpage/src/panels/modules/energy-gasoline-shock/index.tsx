import { Panel } from '@/components/Panel';
import { fetchRuntimeEnergyGasolineShock } from '@/services/api';
import type { RuntimeEnergyGasolineShockPayload, RuntimeEnergyShockItem, RuntimePolymarketMacroMapPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { LinkedMarketRegistry, MarketImplicationStrip, PanelGlyph, RowGlyph, SourceStack, StatusBadge, linkedMacroMarkets, signalToneClass } from '../macro-intel';
import type { PanelGlyphName } from '../macro-intel';

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

function energyIcon(item?: RuntimeEnergyShockItem): PanelGlyphName {
  const text = `${item?.key || ''} ${item?.label || ''}`.toLowerCase();
  if (text.includes('gasoline') || text.includes('gas')) return 'gas';
  if (text.includes('diesel')) return 'diesel';
  if (text.includes('wti') || text.includes('brent') || text.includes('crude') || text.includes('oil')) return 'oil';
  return 'energy';
}

function EnergyRow({ item }: { item: RuntimeEnergyShockItem }) {
  const tone = itemTone(item.changeWeek);
  return (
    <div className={`wm-energy-row ${tone}`}>
      <RowGlyph icon={energyIcon(item)} tone={tone === 'flat' ? 'neutral' : tone} label={item.label || 'Energy'} />
      <div>
        <span>{String(item.key || '').toUpperCase()}</span>
        <strong>{item.label}</strong>
      </div>
      <strong>{valueLabel(item)}</strong>
      <StatusBadge tone={tone === 'flat' ? 'neutral' : tone}>{`${changeLabel(item.changeWeek)} W`}</StatusBadge>
    </div>
  );
}

function EnergyGasolineShockPanel({ payload, macroPayload }: { payload?: RuntimeEnergyGasolineShockPayload | null; macroPayload?: RuntimePolymarketMacroMapPayload | null }) {
  const summary = payload?.summary;
  const items = payload?.items || [];
  const linkedMarkets = linkedMacroMarkets(macroPayload, ['energy', 'cpi', 'fed']);
  const signalTone = signalToneClass(summary?.signal);
  return (
    <Panel
      title="ENERGY / GAS"
      badge={badge(payload?.status)}
      status={payload?.status === 'ok' ? 'live' : 'muted'}
      count={items.length}
      className="wm-market-panel wm-energy-shock-panel"
      dataPanelId="energy-gasoline-shock"
    >
      <div className={`wm-intel-signal-band ${signalTone}`}>
        <div className="wm-intel-signal-main">
          <PanelGlyph icon="energy" tone={signalTone} />
          <div className="wm-intel-signal-copy">
            <span>Headline CPI Driver</span>
            <strong>{summary?.signal || 'ENERGY WARMING'}</strong>
          </div>
        </div>
        <em>EIA petroleum stack / CPI impulse {summary?.headlineImpulsePp ?? '--'}pp</em>
      </div>
      <div className="wm-energy-driver-strip">
        <StatusBadge tone={signalTone}>{`CPI impulse ${summary?.headlineImpulsePp ?? '--'}pp`}</StatusBadge>
        <StatusBadge tone="official">{(payload?.cacheMode || 'snapshot').toUpperCase()}</StatusBadge>
      </div>
      <div className="wm-energy-grid">
        {items.map((item) => <EnergyRow key={item.key || item.label || 'energy'} item={item} />)}
      </div>
      <div className="wm-energy-event-log">
        {items.slice(0, 3).map((item) => (
          <div key={`${item.key || item.label}-event`}>
            <RowGlyph icon="source" tone="official" label="EIA source" />
            <span>{String(item.source || 'EIA').toUpperCase()} / {item.cadence || 'series'}</span>
            <strong>{item.label || 'Energy series'} {changeLabel(item.changeWeek)}W</strong>
            <em>{item.date || 'date pending'}</em>
          </div>
        ))}
      </div>
      <div className="wm-energy-links">
        {(summary?.linkedMarkets || ['CPI headline', 'oil', 'Fed']).slice(0, 4).map((label) => <span key={label}>{label}</span>)}
      </div>
      <MarketImplicationStrip items={['Headline CPI', 'Oil markets', 'Gasoline pressure', 'Fed reaction']} />
      <LinkedMarketRegistry title="PMKT energy / CPI" items={linkedMarkets} emptyLabel="Awaiting macro map" />
      <SourceStack sources={payload?.sources} labels={{ wti: 'WTI', gasoline: 'Gasoline', diesel: 'Diesel' }} />
      <div className="wm-energy-footer">
        <span>{(payload?.cacheMode || 'snapshot').toUpperCase()}</span>
        <span>{formatRelative(payload?.generatedAt)}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'energy-gasoline-shock': {
    render: (ctx) => <EnergyGasolineShockPanel payload={ctx.runtimeData['energy-gasoline-shock'] as RuntimeEnergyGasolineShockPayload | undefined} macroPayload={ctx.runtimeData['polymarket-macro-map'] as RuntimePolymarketMacroMapPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'energy-gasoline-shock',
  title: 'Energy & Gasoline Shock',
  eyebrow: 'macro',
  description: 'EIA WTI, gasoline, and diesel pressure for headline CPI markets.',
  defaultEnabled: false,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeEnergyGasolineShock(6),
});
