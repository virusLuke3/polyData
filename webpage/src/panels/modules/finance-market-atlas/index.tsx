import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceMarketAtlas } from '@/services/api';
import type { RuntimeFinanceLinkedMarket, RuntimeFinanceMarketAtlasCategory, RuntimeFinanceMarketAtlasPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, CoverageBadges, dateLabel, FinanceMetricStrip, FinanceRail, FinanceSummaryStrip, moneyLabel, panelTone, percentLabel, signedPercentLabel, sortCycle } from '../finance-common';

type AtlasSort = 'VOLUME' | 'DEADLINE' | 'GAP' | 'COVERAGE';
const SORTS: AtlasSort[] = ['VOLUME', 'DEADLINE', 'GAP', 'COVERAGE'];

function sortItems(items: RuntimeFinanceLinkedMarket[], sort: AtlasSort) {
  return [...items].sort((left, right) => {
    if (sort === 'DEADLINE') return String(left.endDate || '9999').localeCompare(String(right.endDate || '9999'));
    if (sort === 'GAP') return (Number(right.gapScore) || Math.abs(Number(right.change24h) || 0)) - (Number(left.gapScore) || Math.abs(Number(left.change24h) || 0));
    if (sort === 'COVERAGE') return ((right.coverage || []).length - (left.coverage || []).length);
    return (Number(right.volume24h) || 0) - (Number(left.volume24h) || 0);
  });
}

function CategoryRow({ item }: { item: RuntimeFinanceMarketAtlasCategory }) {
  return (
    <div className="wm-finance-category-row wm-finance-category-row-v2">
      <div>
        <strong>{item.label || item.id || 'Finance'}</strong>
        <span>{Number(item.activeCount) || 0} mkts</span>
      </div>
      <em>{moneyLabel(item.volume24h)}</em>
      <CoverageBadges items={item.coverage} max={3} />
    </div>
  );
}

function MarketRow({ item }: { item: RuntimeFinanceLinkedMarket }) {
  const category = String(item.category || 'fin').toUpperCase();
  return (
    <div className="wm-finance-registry-row">
      <FinanceRail label={category.slice(0, 4)} tone={item.change24h && Number(item.change24h) > 0 ? 'ok' : 'neutral'} />
      <div className="wm-finance-registry-main">
        <div className="wm-finance-registry-meta">
          <span>{item.categoryLabel || item.category || 'finance'}</span>
          <span>{dateLabel(item.endDate)}</span>
          <CoverageBadges items={item.coverage} max={3} />
        </div>
        <strong>{item.title || 'Finance market'}</strong>
        <FinanceMetricStrip
          items={[
            { label: 'PMKT', value: percentLabel(item.probability), tone: 'ok' },
            { label: '24H', value: signedPercentLabel(item.change24h), tone: Number(item.change24h) > 0 ? 'ok' : Number(item.change24h) < 0 ? 'bad' : 'neutral' },
            { label: 'VOL', value: moneyLabel(item.volume24h) },
          ]}
        />
      </div>
    </div>
  );
}

function FinanceMarketAtlasPanel({ payload }: { payload?: RuntimeFinanceMarketAtlasPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sort, setSort] = useState<AtlasSort>('VOLUME');
  const items = sortItems(payload?.items || [], sort);
  const top = payload?.summary?.topDislocation || items[0];
  return (
    <Panel
      title="FINANCE ATLAS"
      titleControls={(
        <button type="button" className="wm-panel-help-button" aria-label="Explain finance atlas" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>?</button>
      )}
      controls={<button type="button" className="wm-finance-header-action" onClick={() => setSort((value) => sortCycle(SORTS, value))}>{sort}</button>}
      badge={badgeLabel(payload?.status) || 'PMKT'}
      status={panelTone(payload?.status)}
      count={payload?.summary?.activeCount || items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Finance Atlas</strong>
          <p>Classifies active Polymarket finance markets, then tags each row with available quote, CLOB, oracle, ETF, perp, filing, and flow coverage.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-finance-panel"
      dataPanelId="finance-market-atlas"
    >
      <FinanceSummaryStrip
        items={[
          { label: 'active', value: payload?.summary?.activeCount || items.length, tone: 'ok' },
          { label: 'categories', value: payload?.summary?.categoryCount || (payload?.categories || []).length },
          { label: 'top', value: payload?.summary?.topCategory || '--' },
          { label: 'sources', value: payload?.summary?.coverageCount || 0, tone: 'watch' },
        ]}
      />
      {top ? (
        <div className="wm-finance-lead-row">
          <FinanceRail label={String(top.category || 'FIN').slice(0, 4).toUpperCase()} tone="ok" />
          <div className="wm-finance-registry-main">
            <div className="wm-finance-registry-meta">
              <span>Top finance market</span>
              <span>{dateLabel(top.endDate)}</span>
              <CoverageBadges items={top.coverage} max={4} />
            </div>
            <strong>{top.title || 'Finance market'}</strong>
            <FinanceMetricStrip
              items={[
                { label: 'PMKT', value: percentLabel(top.probability), tone: 'ok' },
                { label: 'VOL', value: moneyLabel(top.volume24h) },
                { label: '24H', value: signedPercentLabel(top.change24h), tone: Number(top.change24h) > 0 ? 'ok' : Number(top.change24h) < 0 ? 'bad' : 'neutral' },
              ]}
            />
          </div>
        </div>
      ) : null}
      <div className="wm-finance-category-grid wm-finance-category-grid-v2">
        {(payload?.categories || []).slice(0, 5).map((category) => <CategoryRow key={category.id || category.label} item={category} />)}
      </div>
      <div className="wm-finance-list">
        {items.length ? items.map((item, index) => <MarketRow key={`${item.marketId || item.title || 'market'}-${index}`} item={item} />) : (
          <div className="wm-empty-state"><strong>Finance atlas warming.</strong><em>No finance markets are cached yet.</em></div>
        )}
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'finance-market-atlas': {
    render: (ctx) => <FinanceMarketAtlasPanel payload={ctx.runtimeData['finance-market-atlas'] as RuntimeFinanceMarketAtlasPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'finance-market-atlas',
  title: 'Finance Market Atlas',
  eyebrow: 'finance',
  description: 'Active Polymarket finance markets grouped by category with external coverage flags.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 60000,
  fetchData: () => fetchRuntimeFinanceMarketAtlas(16),
});
