import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeEquityEventCommand } from '@/services/api';
import type { RuntimeEquityEventCommandPayload, RuntimeEquityEventRow } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, CoverageBadges, dateLabel, FinanceMetricStrip, FinanceRail, FinanceSummaryStrip, moneyLabel, panelTone, percentLabel, signedPercentLabel, sortCycle } from '../finance-common';

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
    <div className="wm-finance-registry-row">
      <FinanceRail label={item.symbol || 'EQ'} tone={Number(item.change1d) > 0 ? 'ok' : Number(item.change1d) < 0 ? 'bad' : 'neutral'} />
      <div className="wm-finance-registry-main">
        <div className="wm-finance-registry-meta">
          <span>{item.eventType || 'LINKED'}</span>
          <span>{dateLabel(item.nextEventAt)}</span>
          <div className="wm-finance-chip-row">
            {(item.badges || []).slice(0, 3).map((badge) => <span key={badge} className="wm-finance-chip watch">{badge}</span>)}
          </div>
        </div>
        <strong>{item.company || item.symbol || 'Equity'} / {item.nextEvent || 'market watch'}</strong>
        <FinanceMetricStrip
          items={[
            { label: 'QUOTE', value: moneyLabel(item.price), tone: Number(item.change1d) > 0 ? 'ok' : Number(item.change1d) < 0 ? 'bad' : 'neutral' },
            { label: 'MOVE', value: signedPercentLabel(item.change1d), tone: Number(item.change1d) > 0 ? 'ok' : Number(item.change1d) < 0 ? 'bad' : 'neutral' },
            { label: 'PMKT', value: percentLabel(linked?.probability), tone: 'ok' },
            { label: 'VOL', value: moneyLabel(linked?.volume24h || item.volume24h) },
          ]}
        />
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
      <FinanceSummaryStrip
        items={[
          { label: 'tracked', value: payload?.summary?.trackedCount || items.length, tone: 'ok' },
          { label: 'linked', value: payload?.summary?.catalystCount || 0, tone: 'watch' },
          { label: 'top', value: payload?.summary?.topSymbol || '--' },
          { label: 'mode', value: 'quote' },
        ]}
      />
      {top ? (
        <div className="wm-finance-lead-row">
          <FinanceRail label={top.symbol || 'EQ'} tone={Number(top.change1d) > 0 ? 'ok' : Number(top.change1d) < 0 ? 'bad' : 'neutral'} />
          <div className="wm-finance-registry-main">
            <div className="wm-finance-registry-meta">
              <span>Command row</span>
              <span>{dateLabel(top.nextEventAt)}</span>
              <CoverageBadges items={(top.linkedMarkets || [])[0]?.coverage || top.badges} max={4} />
            </div>
            <strong>{top.company || top.symbol} / {top.nextEvent || 'linked market'}</strong>
            <FinanceMetricStrip
              items={[
                { label: 'QUOTE', value: moneyLabel(top.price), tone: Number(top.change1d) > 0 ? 'ok' : Number(top.change1d) < 0 ? 'bad' : 'neutral' },
                { label: 'MOVE', value: signedPercentLabel(top.change1d), tone: Number(top.change1d) > 0 ? 'ok' : Number(top.change1d) < 0 ? 'bad' : 'neutral' },
                { label: 'PMKT', value: percentLabel((top.linkedMarkets || [])[0]?.probability) },
              ]}
            />
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
