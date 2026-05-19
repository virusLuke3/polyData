import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceMarketAtlas } from '@/services/api';
import type { RuntimeFinanceLinkedMarket, RuntimeFinanceMarketAtlasCategory, RuntimeFinanceMarketAtlasPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, CoverageBadges, dateLabel, FinanceMark, moneyLabel, panelTone, percentLabel, signedPercentLabel, sortCycle } from '../finance-common';

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
    <div className="wm-finance-category-row">
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
  return (
    <div className="wm-finance-market-row">
      <FinanceMark label={(item.category || 'FIN').slice(0, 3).toUpperCase()} tone={item.change24h && Number(item.change24h) > 0 ? 'ok' : 'neutral'} />
      <div className="wm-finance-row-main">
        <span>{dateLabel(item.endDate)} / {item.categoryLabel || item.category || 'finance'}</span>
        <strong>{item.title || 'Finance market'}</strong>
      </div>
      <div className="wm-finance-row-values">
        <strong>{percentLabel(item.probability)}</strong>
        <em>{signedPercentLabel(item.change24h)}</em>
      </div>
      <CoverageBadges items={item.coverage} max={3} />
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
      {top ? (
        <div className="wm-finance-hero">
          <FinanceMark label="FIN" tone="ok" />
          <div>
            <span>Top finance market</span>
            <strong>{top.title || 'Finance market'}</strong>
            <em>{percentLabel(top.probability)} / {moneyLabel(top.volume24h)} / {dateLabel(top.endDate)}</em>
          </div>
          <CoverageBadges items={top.coverage} max={4} />
        </div>
      ) : null}
      <div className="wm-finance-category-grid">
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
