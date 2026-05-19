import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeOnchainTradfiPerpRadar } from '@/services/api';
import type { RuntimeOnchainTradfiPerpRadarPayload, RuntimeOnchainTradfiPerpRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, basisTone, CoverageBadges, MiniBar, MiniSparkline, moneyLabel, numberLabel, numericValue, panelTone, signedPercentLabel, sortCycle } from '../finance-common';

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
  const tone = basisTone(item.basisBps ?? item.funding);
  return (
    <div className={`wm-finance-perp-line ${tone}`}>
      <span className="wm-finance-line-code">{item.symbol || 'PERP'}</span>
      <MiniSparkline seed={`${item.symbol}-${item.markPx}`} tone={tone} bias={numericValue(item.basisBps ?? item.funding) >= 0 ? 0.45 : -0.45} />
      <div className="wm-finance-line-main">
        <div className="wm-finance-line-meta">
          <span>{String(item.assetClass || 'asset').toUpperCase()}</span>
          <CoverageBadges items={item.alerts || ['PERP']} max={2} />
        </div>
        <strong>{item.display || item.symbol || 'TradFi perp'}</strong>
        <MiniBar value={item.compositeScore} max={30} tone={tone} />
      </div>
      <div className="wm-finance-line-value">
        <strong>{moneyLabel(item.markPx)}</strong>
        <span>{basisLabel(item.basisBps)}</span>
        <em>{funding}</em>
      </div>
      <div className="wm-finance-perp-meta">
        <span>OI {numberLabel(item.openInterest)}</span>
        <span>VOL {moneyLabel(item.dayNotional)}</span>
        <span>{linked ? `PMKT ${numberLabel(linked.probability, 0)}%` : 'NO LINK'}</span>
      </div>
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
      <div className="wm-finance-brief-line wm-finance-ticker-strip">
        <span><strong>{numberLabel(payload?.summary?.assetCount || items.length, 0)}</strong> assets</span>
        <span><strong>{numberLabel(payload?.summary?.alertCount || 0, 0)}</strong> alerts</span>
        <span><strong>{top?.symbol || '--'}</strong> top</span>
        <span><strong>Hyper/XYZ</strong> source</span>
      </div>
      {top ? (
        <div className="wm-finance-cot-head">
          <div>
            <strong>{top.display || top.symbol}</strong>
            <span>{(top.alerts || ['PERP ANOMALY']).join(' / ')}</span>
          </div>
          <MiniSparkline seed={`${top.symbol}-lead`} tone={basisTone(top.basisBps ?? top.funding)} bias={numericValue(top.basisBps ?? top.funding) >= 0 ? 0.45 : -0.45} />
          <div>
            <strong>{moneyLabel(top.markPx)}</strong>
            <span>{basisLabel(top.basisBps)}</span>
          </div>
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
