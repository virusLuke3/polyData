import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimePolymarketMacroMap } from '@/services/api';
import type {
  RuntimePolymarketMacroMapCategory,
  RuntimePolymarketMacroMapItem,
  RuntimePolymarketMacroMapPayload,
} from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { MarketImplicationStrip, PanelGlyph, SourceStack, signalToneClass } from '../macro-intel';

function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'LIVE';
  if (normalized === 'degraded') return 'PARTIAL';
  if (normalized === 'empty') return 'EMPTY';
  return 'STALE';
}

function panelTone(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

function numberLabel(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  if (Math.abs(numeric) >= 1000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numeric);
}

function probabilityLabel(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${Math.round(numeric * 100)}%`;
}

function catalystLabel(payload?: RuntimePolymarketMacroMapPayload | null) {
  const catalyst = payload?.summary?.topCatalyst;
  if (!catalyst?.endDate) return 'No dated catalyst';
  return formatRelative(catalyst.endDate);
}

function categoryTone(index: number) {
  return ['green', 'amber', 'blue', 'violet', 'red'][index % 5];
}

function shortCategoryLabel(category?: RuntimePolymarketMacroMapCategory | null) {
  const id = String(category?.id || '').toLowerCase();
  if (id === 'cpi') return 'CPI';
  if (id === 'fed') return 'FED';
  if (id === 'growth') return 'GROWTH';
  if (id === 'labor') return 'LABOR';
  if (id === 'energy') return 'ENERGY';
  return (String(category?.label || 'MACRO').split('/')[0] || 'MACRO').trim().toUpperCase();
}

function signalLabel(value?: string | null) {
  return String(value || 'WARMING')
    .replace(/oil\s*\/\s*energy/gi, 'ENERGY')
    .replace(/cpi\s*\/\s*inflation/gi, 'CPI')
    .replace(/growth\s*\/\s*recession/gi, 'GROWTH')
    .replace(/fed\s*\/\s*rates/gi, 'FED');
}

function clusterLabel(value?: string | null) {
  return signalLabel(value).replace(' CLUSTER ACTIVE', '');
}

function MacroCategoryMatrix({ categories }: { categories: RuntimePolymarketMacroMapCategory[] }) {
  return (
    <div className="wm-macro-map-category-grid">
      {categories.map((category, index) => (
        <div key={category.id || category.label || index} className={`wm-macro-map-category ${categoryTone(index)}`}>
          <div>
            <span>{shortCategoryLabel(category)}</span>
            <strong>{category.activeCount ?? 0}</strong>
          </div>
          <em>{category.marketType || 'Market cluster'}</em>
        </div>
      ))}
    </div>
  );
}

function MacroMarketRow({ item }: { item: RuntimePolymarketMacroMapItem }) {
  const topOutcome = item.topOutcomes?.[0];
  const category = item.categoryLabels?.[0] || 'Macro';
  const outcomeLabel = String(topOutcome?.label || '').trim();
  return (
    <div className={`wm-macro-map-row ${signalToneClass(category)}`}>
      <div className="wm-macro-map-row-main">
        <div className="wm-macro-map-meta">
          <span>{category.toUpperCase()}</span>
          <span>/</span>
          <span>{item.endDate ? formatRelative(item.endDate) : 'OPEN'}</span>
          <span>/</span>
          <span>VOL {numberLabel(item.volume24h)}</span>
        </div>
        <strong>{item.title || 'Untitled macro market'}</strong>
        <div className="wm-macro-map-subline">
          {(item.marketTypes || []).slice(0, 2).join(' / ') || 'Polymarket macro route'}
        </div>
      </div>
      <div className="wm-macro-map-prob">
        <span>{probabilityLabel(topOutcome?.yesPrice)}</span>
        <em>{outcomeLabel && outcomeLabel.length <= 14 ? outcomeLabel : 'TOP YES'}</em>
      </div>
    </div>
  );
}

function MacroMarketList({ items }: { items: RuntimePolymarketMacroMapItem[] }) {
  if (!items.length) {
    return (
      <div className="wm-empty-state">
        <strong>No macro market cluster found.</strong>
        <em>Gamma feed is available, but no active CPI/Fed/GDP/oil markets matched the current terms.</em>
      </div>
    );
  }
  return (
    <div className="wm-macro-map-list">
      {items.map((item, index) => (
        <MacroMarketRow key={`${item.eventId || item.slug || 'macro'}-${index}`} item={item} />
      ))}
    </div>
  );
}

function PolymarketMacroMapPanel({ payload }: { payload?: RuntimePolymarketMacroMapPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const categories = payload?.categories || [];
  const items = payload?.items || [];
  const summary = payload?.summary;
  const topMarkets = items.slice(0, 3).map((item) => item.categoryLabels?.[0] || 'PMKT');
  return (
    <Panel
      title="PMKT MACRO MAP"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain macro market map"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={badgeLabel(payload?.status)}
      status={panelTone(payload?.status)}
      count={summary?.activeCount ?? items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Macro Market Map</strong>
          <p>Routes active Polymarket events into CPI, Fed, growth, labor, and energy clusters so macro signals can be tied back to tradable markets.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-macro-map-panel"
      dataPanelId="polymarket-macro-map"
    >
      <div className={`wm-intel-signal-band ${signalToneClass(summary?.signal)}`}>
        <div className="wm-intel-signal-main">
          <PanelGlyph icon="radar" tone={signalToneClass(summary?.signal)} />
          <div className="wm-intel-signal-copy">
            <span>Signal</span>
            <strong>{signalLabel(summary?.signal)}</strong>
          </div>
        </div>
        <em>Polymarket macro route / {summary?.activeCount ?? items.length} active</em>
      </div>
      <div className="wm-macro-map-summary">
        <div>
          <span>PMKT Coverage</span>
          <strong>{summary?.activeCount ?? items.length}</strong>
        </div>
        <div>
          <span>Top Catalyst</span>
          <strong>{catalystLabel(payload)}</strong>
        </div>
        <div>
          <span>Top Cluster</span>
          <strong>{clusterLabel(summary?.topCategory || 'Macro')}</strong>
        </div>
      </div>
      <MarketImplicationStrip items={topMarkets.length ? topMarkets : ['CPI', 'Fed', 'Growth']} />
      <MacroCategoryMatrix categories={categories} />
      <MacroMarketList items={items} />
      <SourceStack sources={payload?.sources} labels={{ gammaEvents: 'Gamma', gammaSearch: 'Search' }} />
      <div className="wm-macro-map-footer">
        <span>{(payload?.sources?.gammaEvents || payload?.status || 'warming').toUpperCase()}</span>
        <span>{(payload?.cacheMode || 'snapshot').toUpperCase()}</span>
        <span>{formatRelative(payload?.generatedAt)}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'polymarket-macro-map': {
    render: (ctx) => {
      const payload = ctx.runtimeData['polymarket-macro-map'] as RuntimePolymarketMacroMapPayload | undefined;
      return <PolymarketMacroMapPanel payload={payload} />;
    },
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'polymarket-macro-map',
  title: 'Polymarket Macro Market Map',
  eyebrow: 'macro',
  description: 'Active CPI, Fed, growth, labor, and energy market clusters from Polymarket.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimePolymarketMacroMap(12),
});
