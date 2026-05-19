import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeEquityEventCommand } from '@/services/api';
import type { RuntimeEquityEventCommandPayload, RuntimeEquityEventRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, CoverageBadges, dateLabel, financeTone, MiniBar, MiniSparkline, moneyLabel, panelTone, percentLabel, signedPercentLabel, sortCycle } from '../finance-common';

type EquitySort = 'PMKT GAP' | 'NEXT EVENT' | 'STOCK MOVE' | 'VOLUME';
const SORTS: EquitySort[] = ['PMKT GAP', 'NEXT EVENT', 'STOCK MOVE', 'VOLUME'];

function sortItems(items: RuntimeEquityEventRow[], sort: EquitySort) {
  return [...items].sort((left, right) => {
    if (sort === 'NEXT EVENT') return String(left.nextEventAt || '9999').localeCompare(String(right.nextEventAt || '9999'));
    if (sort === 'STOCK MOVE') return Math.abs(Number(right.change1d) || 0) - Math.abs(Number(left.change1d) || 0);
    if (sort === 'VOLUME') return (Number(right.volume24h) || 0) - (Number(left.volume24h) || 0);
    return (Number(right.pmktGapScore) || 0) - (Number(left.pmktGapScore) || 0);
  });
}

function EventRow({ item }: { item: RuntimeEquityEventRow }) {
  const linked = (item.linkedMarkets || [])[0];
  const tone = financeTone(item.change1d);
  return (
    <div className={`wm-finance-equity-line ${tone}`}>
      <span className="wm-finance-line-code">{item.symbol || '--'}</span>
      <MiniSparkline seed={`${item.symbol}-${item.price}`} tone={tone} bias={Number(item.change1d) >= 0 ? 0.45 : -0.45} />
      <div className="wm-finance-line-main">
        <div className="wm-finance-line-meta">
          <span>{item.eventType || 'LINKED'}</span>
          <span>{dateLabel(item.nextEventAt)}</span>
          <CoverageBadges items={linked?.coverage || item.badges} max={3} />
        </div>
        <strong>{item.company || item.symbol || 'Equity'}</strong>
        <span>{item.nextEvent || linked?.title || 'market watch'}</span>
      </div>
      <div className="wm-finance-equity-price">
        <strong>{moneyLabel(item.price)}</strong>
        <em className={tone}>{signedPercentLabel(item.change1d)}</em>
      </div>
      <div className="wm-finance-equity-event">
        <MiniBar value={Number(linked?.probability) * 100} tone={tone} />
      </div>
      <div className="wm-finance-equity-tags">
        <span>PMKT {percentLabel(linked?.probability)}</span>
        <span>VOL {moneyLabel(linked?.volume24h || item.volume24h)}</span>
      </div>
    </div>
  );
}

function EquityEventCommandPanel({ payload }: { payload?: RuntimeEquityEventCommandPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sort, setSort] = useState<EquitySort>('PMKT GAP');
  const items = sortItems(payload?.items || [], sort);
  const top = items[0];
  return (
    <Panel
      title="EQUITY EVENTS"
      titleControls={<button type="button" className="wm-panel-help-button" aria-label="Explain equity event command" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>?</button>}
      controls={<button type="button" className="wm-finance-header-action" onClick={() => setSort((value) => sortCycle(SORTS, value))}>{sort}</button>}
      badge={badgeLabel(payload?.status) || 'QUOTE/EARN'}
      status={panelTone(payload?.status)}
      count={payload?.summary?.catalystCount || items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Equity Events</strong>
          <p>Links company tickers to Polymarket markets and tags quote, earnings, filing, IPO, and crypto-linked catalysts when present.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-finance-panel"
      dataPanelId="equity-event-command"
    >
      <div className="wm-finance-brief-line wm-finance-ticker-strip">
        <span><strong>{payload?.summary?.trackedCount || items.length}</strong> tracked</span>
        <span><strong>{payload?.summary?.catalystCount || 0}</strong> linked</span>
        <span><strong>{payload?.summary?.topSymbol || '--'}</strong> top</span>
        <span><strong>quote</strong> mode</span>
      </div>
      {top ? (
        <div className="wm-finance-watch-head">
          <div>
            <strong>{top.company || top.symbol}</strong>
            <span>{top.symbol || '--'} · {top.nextEvent || 'linked market'}</span>
          </div>
          <MiniSparkline seed={`${top.symbol}-lead`} tone={financeTone(top.change1d)} bias={Number(top.change1d) >= 0 ? 0.45 : -0.45} />
          <div>
            <strong>{moneyLabel(top.price)}</strong>
            <em className={financeTone(top.change1d)}>{signedPercentLabel(top.change1d)}</em>
          </div>
        </div>
      ) : null}
      <div className="wm-finance-list">
        {items.length ? items.map((item) => <EventRow key={item.symbol || item.company} item={item} />) : (
          <div className="wm-empty-state"><strong>Equity command warming.</strong><em>Quote and linked market rows are not cached yet.</em></div>
        )}
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'equity-event-command': {
    render: (ctx) => <EquityEventCommandPanel payload={ctx.runtimeData['equity-event-command'] as RuntimeEquityEventCommandPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'equity-event-command',
  title: 'Equity Event Command',
  eyebrow: 'finance',
  description: 'Company quote, catalyst, and linked Polymarket market command list.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 60000,
  fetchData: () => fetchRuntimeEquityEventCommand(12),
});
