import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceLiquidityRegime } from '@/services/api';
import type { RuntimeFinanceLiquidityRegimePayload, RuntimeFinanceLiquidityRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, FinanceSignalRow, moneyLabel, numberLabel, panelTone, sortCycle } from '../finance-common';

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
    <FinanceSignalRow
      tone={item.tone || 'neutral'}
      code={item.source || 'PMKT'}
      meta={(
        <>
          <span>{item.source || 'PMKT'}</span>
          <span>{item.signal || 'WATCH'}</span>
          <div className="wm-finance-chip-row">
            <span className={`wm-finance-chip ${item.tone || 'neutral'}`}>{String(item.tone || 'neutral').toUpperCase()}</span>
          </div>
        </>
      )}
      title={item.label || 'Liquidity row'}
      stats={[
        { label: 'FLOW', value: moneyLabel(item.value), tone: item.tone || 'neutral' },
        { label: 'PMKT', value: item.linkedMarket ? `${numberLabel(item.linkedMarket.probability, 0)}%` : 'NO LINK', tone: item.linkedMarket ? 'ok' : 'neutral' },
        { label: 'VOL', value: item.linkedMarket ? moneyLabel(item.linkedMarket.volume24h) : '--' },
      ]}
    />
  );
}

function componentWidth(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '8%';
  return `${Math.max(6, Math.min(100, Math.abs(numeric)))}%`;
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
      <div className="wm-finance-brief-line">
        <span><strong>{numberLabel(summary?.regimeScore, 0)}</strong> score</span>
        <span><strong>{summary?.regimeLabel || 'FRAGILE'}</strong> regime</span>
        <span><strong>{numberLabel(summary?.alertCount || 0, 0)}</strong> alerts</span>
        <span><strong>{numberLabel(items.length, 0)}</strong> rows</span>
      </div>
      <FinanceSignalRow
        className="is-lead"
        tone={Number(summary?.regimeScore) >= 70 ? 'ok' : Number(summary?.regimeScore) >= 52 ? 'watch' : 'bad'}
        code="RISK"
        meta={(
          <>
            <span>{summary?.signal || 'LIQUIDITY WARMING'}</span>
            <span>RISK BACKDROP</span>
          </>
        )}
        title={summary?.regimeLabel || 'FRAGILE'}
        stats={[
          { label: 'SCORE', value: numberLabel(summary?.regimeScore, 0) },
          { label: 'FLOW', value: moneyLabel(pmktVolume) },
          { label: 'ALERTS', value: numberLabel(summary?.alertCount || 0, 0), tone: summary?.alertCount ? 'watch' : 'neutral' },
          { label: 'MODE', value: sort },
        ]}
      />
      <div className="wm-finance-factor-list">
        {(payload?.components || []).slice(0, 5).map((component) => (
          <div key={component.key || component.label} className={`wm-finance-factor-row ${component.tone || 'neutral'}`} style={{ '--finance-fill': componentWidth(component.value) }}>
            <span><strong>{component.label || component.key}</strong><em>{component.detail || component.key}</em></span>
            <b>{component.value === null || component.value === undefined ? 'PENDING' : numberLabel(component.value)}</b>
            <i><small /></i>
          </div>
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
