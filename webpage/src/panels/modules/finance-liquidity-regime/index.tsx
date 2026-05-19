import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceLiquidityRegime } from '@/services/api';
import type { RuntimeFinanceLiquidityRegimePayload, RuntimeFinanceLiquidityRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, FinanceMark, LinkedMarketMini, moneyLabel, numberLabel, panelTone, sortCycle } from '../finance-common';

type LiquiditySort = 'PMKT' | 'COT' | 'FLOW' | 'RISK';
const SORTS: LiquiditySort[] = ['PMKT', 'COT', 'FLOW', 'RISK'];

function sortItems(items: RuntimeFinanceLiquidityRow[], sort: LiquiditySort) {
  return [...items].sort((left, right) => {
    if (sort === 'FLOW') return (Number(right.value) || 0) - (Number(left.value) || 0);
    if (sort === 'RISK') return String(right.tone || '').localeCompare(String(left.tone || ''));
    return String(left.source || '').localeCompare(String(right.source || ''));
  });
}

function LiquidityRow({ item }: { item: RuntimeFinanceLiquidityRow }) {
  return (
    <div className="wm-finance-liquidity-row">
      <FinanceMark label={item.source || 'PMKT'} tone={item.tone || 'neutral'} />
      <div className="wm-finance-row-main">
        <span>{item.signal || 'WATCH'} / {item.source || 'PMKT'}</span>
        <strong>{item.label || 'Liquidity row'}</strong>
      </div>
      <div className="wm-finance-row-values">
        <strong>{moneyLabel(item.value)}</strong>
        <em>{String(item.tone || 'neutral').toUpperCase()}</em>
      </div>
      <LinkedMarketMini market={item.linkedMarket} />
    </div>
  );
}

function FinanceLiquidityRegimePanel({ payload }: { payload?: RuntimeFinanceLiquidityRegimePayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sort, setSort] = useState<LiquiditySort>('FLOW');
  const items = sortItems(payload?.items || [], sort);
  const summary = payload?.summary;
  return (
    <Panel
      title="LIQUIDITY REGIME"
      titleControls={<button type="button" className="wm-panel-help-button" aria-label="Explain liquidity regime" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>?</button>}
      controls={<button type="button" className="wm-finance-header-action" onClick={() => setSort((value) => sortCycle(SORTS, value))}>{sort}</button>}
      badge={badgeLabel(payload?.status) || 'RISK'}
      status={panelTone(payload?.status)}
      count={summary?.alertCount || items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Liquidity Regime</strong>
          <p>Summarizes the finance-market trading environment. It is a liquidity and risk backdrop, not a directional forecast.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-finance-panel"
      dataPanelId="finance-liquidity-regime"
    >
      <div className="wm-finance-regime-hero">
        <FinanceMark label="RISK" tone={Number(summary?.regimeScore) >= 70 ? 'ok' : Number(summary?.regimeScore) >= 52 ? 'watch' : 'bad'} />
        <div>
          <span>{summary?.signal || 'LIQUIDITY WARMING'}</span>
          <strong>{summary?.regimeLabel || 'FRAGILE'}</strong>
        </div>
        <em>{numberLabel(summary?.regimeScore, 0)}</em>
      </div>
      <div className="wm-finance-component-strip">
        {(payload?.components || []).slice(0, 5).map((component) => (
          <span key={component.key || component.label} className={`wm-finance-component ${component.tone || 'neutral'}`}>
            <strong>{component.label || component.key}</strong>
            <em>{component.value === null || component.value === undefined ? component.detail || 'pending' : numberLabel(component.value)}</em>
          </span>
        ))}
      </div>
      <div className="wm-finance-list">
        {items.length ? items.map((item) => <LiquidityRow key={item.id || item.label} item={item} />) : (
          <div className="wm-empty-state"><strong>Liquidity regime warming.</strong><em>Finance liquidity rows are not cached yet.</em></div>
        )}
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'finance-liquidity-regime': {
    render: (ctx) => <FinanceLiquidityRegimePanel payload={ctx.runtimeData['finance-liquidity-regime'] as RuntimeFinanceLiquidityRegimePayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'finance-liquidity-regime',
  title: 'Finance Liquidity Regime',
  eyebrow: 'finance',
  description: 'Finance-market liquidity and risk backdrop using PMKT flow plus seeded external components.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 45000,
  fetchData: () => fetchRuntimeFinanceLiquidityRegime(12),
});
