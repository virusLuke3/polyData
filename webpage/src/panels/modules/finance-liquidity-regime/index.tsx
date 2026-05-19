import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceLiquidityRegime } from '@/services/api';
import type { RuntimeFinanceLiquidityComponent, RuntimeFinanceLiquidityRegimePayload, RuntimeFinanceLiquidityRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, financeTone, MiniBar, MiniSparkline, moneyLabel, numberLabel, numericValue, panelTone, signedNumberLabel, sortCycle } from '../finance-common';

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
  const tone = financeTone(item.value);
  return (
    <div className={`wm-finance-liquidity-line ${tone}`}>
      <MiniSparkline seed={item.id || item.label} tone={tone} bias={numericValue(item.value) >= 0 ? 0.45 : -0.45} />
      <div className="wm-finance-line-main">
        <span>{item.source || 'PMKT'} · {item.signal || 'WATCH'}</span>
        <strong>{item.label || 'Liquidity row'}</strong>
        <MiniBar value={item.linkedMarket?.probability ? Number(item.linkedMarket.probability) * 100 : item.value} max={100} tone={tone} />
      </div>
      <div className="wm-finance-line-value">
        <strong>{item.source === 'ETF' ? moneyLabel(item.value) : signedNumberLabel(item.value)}</strong>
        <span>{item.linkedMarket ? `PMKT ${numberLabel(item.linkedMarket.probability, 0)}%` : 'NO LINK'}</span>
      </div>
    </div>
  );
}

function ComponentRow({ component }: { component: RuntimeFinanceLiquidityComponent }) {
  const tone = financeTone(component.value);
  return (
    <div className={`wm-finance-cot-row ${tone}`}>
      <div>
        <strong>{component.label || component.key}</strong>
        <span>{component.detail || component.key}</span>
      </div>
      <MiniSparkline seed={component.key || component.label} tone={tone} bias={numericValue(component.value) > 0 ? 0.55 : -0.15} />
      <div>
        <b>{component.value === null || component.value === undefined ? 'PENDING' : numberLabel(component.value)}</b>
        <MiniBar value={component.value} max={100} tone={tone} />
      </div>
    </div>
  );
}

function FinanceLiquidityRegimePanel({ payload }: { payload?: RuntimeFinanceLiquidityRegimePayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sort, setSort] = useState<LiquiditySort>('FLOW');
  const items = sortItems(payload?.items || [], sort);
  const summary = payload?.summary;
  const pmktVolume = items.reduce((total, item) => total + (Number(item.value) || 0), 0);
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
      <div className="wm-finance-brief-line wm-finance-ticker-strip">
        <span><strong>{numberLabel(summary?.regimeScore, 0)}</strong> score</span>
        <span><strong>{summary?.regimeLabel || 'FRAGILE'}</strong> regime</span>
        <span><strong>{numberLabel(summary?.alertCount || 0, 0)}</strong> alerts</span>
        <span><strong>{numberLabel(items.length, 0)}</strong> rows</span>
      </div>
      <div className="wm-finance-regime-head">
        <div>
          <span>{summary?.signal || 'LIQUIDITY WARMING'}</span>
          <strong>{summary?.regimeLabel || 'FRAGILE'}</strong>
        </div>
        <MiniSparkline seed="liquidity-regime" tone={Number(summary?.regimeScore) >= 50 ? 'ok' : 'bad'} bias={Number(summary?.regimeScore) >= 50 ? 0.45 : -0.45} />
        <div>
          <b>{numberLabel(summary?.regimeScore, 0)}</b>
          <span>{moneyLabel(pmktVolume)}</span>
        </div>
      </div>
      <div className="wm-finance-cot-list">
        {(payload?.components || []).slice(0, 5).map((component) => <ComponentRow key={component.key || component.label} component={component} />)}
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
