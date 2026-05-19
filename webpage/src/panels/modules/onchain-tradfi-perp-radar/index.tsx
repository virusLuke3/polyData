import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeOnchainTradfiPerpRadar } from '@/services/api';
import type { RuntimeOnchainTradfiPerpRadarPayload, RuntimeOnchainTradfiPerpRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, FinanceMark, LinkedMarketMini, moneyLabel, numberLabel, panelTone, signedPercentLabel, sortCycle } from '../finance-common';

type PerpSort = 'BASIS' | 'OI' | 'FUNDING' | 'PMKT GAP';
const SORTS: PerpSort[] = ['BASIS', 'OI', 'FUNDING', 'PMKT GAP'];

function sortItems(items: RuntimeOnchainTradfiPerpRow[], sort: PerpSort) {
  return [...items].sort((left, right) => {
    if (sort === 'BASIS') return Math.abs(Number(right.basisBps) || 0) - Math.abs(Number(left.basisBps) || 0);
    if (sort === 'OI') return (Number(right.openInterest) || 0) - (Number(left.openInterest) || 0);
    if (sort === 'FUNDING') return Math.abs(Number(right.funding) || 0) - Math.abs(Number(left.funding) || 0);
    return (Number(right.compositeScore) || 0) - (Number(left.compositeScore) || 0);
  });
}

function basisLabel(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(0)} bps`;
}

function PerpRow({ item }: { item: RuntimeOnchainTradfiPerpRow }) {
  const linked = (item.linkedMarkets || [])[0];
  const funding = item.funding === null || item.funding === undefined ? '--' : signedPercentLabel(item.funding, 3);
  return (
    <div className="wm-finance-perp-row">
      <FinanceMark label={item.symbol || 'PERP'} tone={(item.alerts || []).length ? 'watch' : 'neutral'} />
      <div className="wm-finance-row-main">
        <span>{String(item.assetClass || 'asset').toUpperCase()} / {(item.alerts || ['WATCH']).slice(0, 2).join(' / ')}</span>
        <strong>{item.display || item.symbol || 'TradFi perp'}</strong>
        <div className="wm-finance-micro-grid">
          <span>MARK <strong>{moneyLabel(item.markPx)}</strong></span>
          <span>BASIS <strong>{basisLabel(item.basisBps)}</strong></span>
          <span>FUND <strong>{funding}</strong></span>
        </div>
      </div>
      <div className="wm-finance-row-values">
        <strong>{numberLabel(item.openInterest)}</strong>
        <em>{moneyLabel(item.dayNotional)}</em>
      </div>
      <LinkedMarketMini market={linked} />
    </div>
  );
}

function OnchainTradfiPerpRadarPanel({ payload }: { payload?: RuntimeOnchainTradfiPerpRadarPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sort, setSort] = useState<PerpSort>('PMKT GAP');
  const items = sortItems(payload?.items || [], sort);
  const top = items[0];
  return (
    <Panel
      title="ONCHAIN TRADFI"
      titleControls={<button type="button" className="wm-panel-help-button" aria-label="Explain onchain tradfi perps" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>?</button>}
      controls={<button type="button" className="wm-finance-header-action" onClick={() => setSort((value) => sortCycle(SORTS, value))}>{sort}</button>}
      badge={badgeLabel(payload?.status) || 'HYPER/XYZ'}
      status={panelTone(payload?.status)}
      count={payload?.summary?.assetCount || items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Onchain TradFi</strong>
          <p>Tracks tokenized stock, index, commodity, and crypto perps as price discovery signals. Perps are not stock ownership; basis and funding indicate pressure.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-finance-panel"
      dataPanelId="onchain-tradfi-perp-radar"
    >
      {top ? (
        <div className="wm-finance-hero compact">
          <FinanceMark label={top.symbol || 'PERP'} tone="watch" />
          <div>
            <span>Perp anomaly</span>
            <strong>{top.display || top.symbol} / {basisLabel(top.basisBps)}</strong>
            <em>{(top.alerts || ['PMKT LINK']).join(' / ')}</em>
          </div>
          <LinkedMarketMini market={(top.linkedMarkets || [])[0]} />
        </div>
      ) : null}
      <div className="wm-finance-list">
        {items.length ? items.map((item) => <PerpRow key={`${item.symbol}-${item.display}`} item={item} />) : (
          <div className="wm-empty-state"><strong>TradFi perp radar warming.</strong><em>Hyperliquid/trade.xyz rows are not seeded yet.</em></div>
        )}
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'onchain-tradfi-perp-radar': {
    render: (ctx) => <OnchainTradfiPerpRadarPanel payload={ctx.runtimeData['onchain-tradfi-perp-radar'] as RuntimeOnchainTradfiPerpRadarPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'onchain-tradfi-perp-radar',
  title: 'Onchain TradFi Perp Radar',
  eyebrow: 'finance',
  description: 'Tokenized TradFi perp pressure, basis, funding, and linked Polymarket rows.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 45000,
  fetchData: () => fetchRuntimeOnchainTradfiPerpRadar(12),
});
