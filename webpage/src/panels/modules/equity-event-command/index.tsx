import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeEquityEventCommand } from '@/services/api';
import type { RuntimeEquityEventCommandPayload, RuntimeEquityEventRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, dateLabel, FinanceMark, LinkedMarketMini, moneyLabel, panelTone, signedPercentLabel, sortCycle } from '../finance-common';

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
  return (
    <div className="wm-finance-equity-row">
      <FinanceMark label={item.symbol || 'EQ'} tone={Number(item.change1d) > 0 ? 'ok' : Number(item.change1d) < 0 ? 'bad' : 'neutral'} />
      <div className="wm-finance-row-main">
        <span>{item.eventType || 'LINKED'} / {dateLabel(item.nextEventAt)}</span>
        <strong>{item.company || item.symbol || 'Equity'}: {item.nextEvent || 'market watch'}</strong>
        <div className="wm-finance-chip-row">
          {(item.badges || []).slice(0, 4).map((badge) => <span key={badge} className="wm-finance-chip watch">{badge}</span>)}
        </div>
      </div>
      <div className="wm-finance-row-values">
        <strong>{moneyLabel(item.price)}</strong>
        <em>{signedPercentLabel(item.change1d)}</em>
      </div>
      <LinkedMarketMini market={linked} />
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
      {top ? (
        <div className="wm-finance-hero compact">
          <FinanceMark label={top.symbol || 'EQ'} tone="ok" />
          <div>
            <span>Command row</span>
            <strong>{top.company || top.symbol} / {signedPercentLabel(top.change1d)}</strong>
            <em>{top.nextEvent || 'linked market'} / {moneyLabel(top.volume24h)}</em>
          </div>
          <LinkedMarketMini market={(top.linkedMarkets || [])[0]} />
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
