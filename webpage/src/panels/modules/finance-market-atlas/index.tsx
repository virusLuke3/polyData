import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceMarketAtlas } from '@/services/api';
import type { RuntimeFinanceLinkedMarket, RuntimeFinanceMarketAtlasCategory, RuntimeFinanceMarketAtlasPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, CoverageBadges, dateLabel, financeTone, MiniBar, moneyLabel, panelTone, percentLabel, signedPercentLabel, sortCycle } from '../finance-common';

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
    <div className="wm-finance-quote-row compact">
      <div className="wm-finance-quote-main">
        <strong>{item.label || item.id || 'Finance'}</strong>
        <span>{Number(item.activeCount) || 0} MKTS</span>
      </div>
      <div className="wm-finance-quote-value">
        <strong>{moneyLabel(item.volume24h)}</strong>
        <CoverageBadges items={item.coverage} max={3} />
      </div>
    </div>
  );
}

function MarketRow({ item }: { item: RuntimeFinanceLinkedMarket }) {
  const category = String(item.category || 'fin').toUpperCase();
  const tone = financeTone(item.change24h);
  return (
    <div className={`wm-finance-market-line ${tone}`}>
      <span className="wm-finance-line-code">{category.slice(0, 4)}</span>
      <div className="wm-finance-line-main">
        <div className="wm-finance-line-meta">
          <span>{item.categoryLabel || item.category || 'finance'}</span>
          <span>{dateLabel(item.endDate)}</span>
          <CoverageBadges items={item.coverage} max={3} />
        </div>
        <strong>{item.title || 'Finance market'}</strong>
        <MiniBar value={Number(item.probability) * 100} tone="ok" />
      </div>
      <div className="wm-finance-line-value">
        <strong>{percentLabel(item.probability)}</strong>
        <span>{moneyLabel(item.volume24h)}</span>
        <em className={tone}>{signedPercentLabel(item.change24h)}</em>
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
      <div className="wm-finance-brief-line">
        <span><strong>{payload?.summary?.activeCount || items.length}</strong> active</span>
        <span><strong>{payload?.summary?.categoryCount || (payload?.categories || []).length}</strong> categories</span>
        <span><strong>{payload?.summary?.topCategory || '--'}</strong> top</span>
        <span><strong>{payload?.summary?.coverageCount || 0}</strong> sources</span>
      </div>
      {top ? (
        <div className="wm-finance-market-head">
          <span>{String(top.category || 'FIN').toUpperCase()}</span>
          <strong>{top.title || 'Finance market'}</strong>
          <div>
            <em>PMKT <b>{percentLabel(top.probability)}</b></em>
            <em>VOL <b>{moneyLabel(top.volume24h)}</b></em>
            <em>24H <b className={financeTone(top.change24h)}>{signedPercentLabel(top.change24h)}</b></em>
          </div>
          <MiniBar value={Number(top.probability) * 100} tone="ok" />
        </div>
      ) : null}
      <div className="wm-finance-quote-list">
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
