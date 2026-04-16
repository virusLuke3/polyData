import { Panel } from '@/components/Panel';
import type { PanelRenderContext } from '@/types';
import type { PanelRenderMap } from './types';
import { formatCompact, formatPercent } from './shared/formatters';
import { emptyState, tradeList, tradeSignalList } from './shared/renderers';
import { focusedTrades } from './shared/selectors';

function lobPanel(ctx: PanelRenderContext, showDepth: boolean) {
  const lob = ctx.bundle?.lob;
  if (!lob) return emptyState('LOB runtime unavailable for the selected market.');
  if (!showDepth) {
    return (
      <div className="wm-summary-grid">
        <div className="wm-summary-row"><span>YES BBO</span><strong>{formatPercent(lob.yes?.bestBid)} / {formatPercent(lob.yes?.bestAsk)}</strong></div>
        <div className="wm-summary-row"><span>YES SPR</span><strong>{formatPercent(lob.yes?.spread)}</strong></div>
        <div className="wm-summary-row"><span>NO BBO</span><strong>{formatPercent(lob.no?.bestBid)} / {formatPercent(lob.no?.bestAsk)}</strong></div>
        <div className="wm-summary-row"><span>NO SPR</span><strong>{formatPercent(lob.no?.spread)}</strong></div>
      </div>
    );
  }
  return (
    <div className="wm-lob-layout">
      <div className="wm-lob-side-card">
        <div className="wm-lob-head">
          <span>YES BOOK</span>
          <strong>{formatPercent(lob.yes?.bestBid)} / {formatPercent(lob.yes?.bestAsk)}</strong>
        </div>
        <div className="wm-depth-list">
          {[...(lob.yes?.bids || []).slice(0, 4), ...(lob.yes?.asks || []).slice(0, 4)].map((level, index) => (
            <div className={`wm-depth-row ${index >= (lob.yes?.bids || []).slice(0, 4).length ? 'ask' : ''}`} key={`yes-${index}`}>
              <span>{index >= (lob.yes?.bids || []).slice(0, 4).length ? 'ASK' : 'BID'}</span>
              <strong>{formatPercent(level.price)}</strong>
              <em>{formatCompact(level.size)}</em>
            </div>
          ))}
        </div>
      </div>
      <div className="wm-lob-side-card">
        <div className="wm-lob-head">
          <span>NO BOOK</span>
          <strong>{formatPercent(lob.no?.bestBid)} / {formatPercent(lob.no?.bestAsk)}</strong>
        </div>
        <div className="wm-depth-list">
          {[...(lob.no?.bids || []).slice(0, 4), ...(lob.no?.asks || []).slice(0, 4)].map((level, index) => (
            <div className={`wm-depth-row ${index >= (lob.no?.bids || []).slice(0, 4).length ? 'ask' : ''}`} key={`no-${index}`}>
              <span>{index >= (lob.no?.bids || []).slice(0, 4).length ? 'ASK' : 'BID'}</span>
              <strong>{formatPercent(level.price)}</strong>
              <em>{formatCompact(level.size)}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


export const chainPanelRenderers: PanelRenderMap = {
  'global-orderfilled': {
    render: (ctx) => (
      <Panel title="ORDERFILLED FLOW" badge="FOCUSED" status="live" count={focusedTrades(ctx).length}>
        {tradeList(focusedTrades(ctx), 10)}
      </Panel>
    ),
  },
  'sample-chain-trades': {
    render: (ctx) => (
      <Panel title="MARKET TAPE" badge="FOCUSED" status="live" count={focusedTrades(ctx).length}>
        {tradeList(focusedTrades(ctx), 12)}
      </Panel>
    ),
  },
  'bbo-monitor': {
    render: (ctx) => (
      <Panel title="BBO MONITOR" badge="LIVE" status="live">
        {lobPanel(ctx, false)}
      </Panel>
    ),
  },
  'lob-depth': {
    render: (ctx) => (
      <Panel title="LOB DEPTH" badge="LIVE" status="live">
        {lobPanel(ctx, true)}
      </Panel>
    ),
  },
  'whale-tracker': {
    render: (ctx) => (
      <Panel title="WHALE TRACKER" badge="CHAIN" status="live" count={ctx.whaleTrades?.items.length || 0}>
        {tradeSignalList(ctx.whaleTrades?.items || [], 'No whale trades loaded.')}
      </Panel>
    ),
  },
  'suspicious-flow': {
    render: (ctx) => (
      <Panel title="SUSPICIOUS FLOW" badge="WATCH" status="live" count={ctx.suspiciousTrades?.items.length || 0}>
        {tradeSignalList(ctx.suspiciousTrades?.items || [], 'No suspicious flow loaded.')}
      </Panel>
    ),
  },
};
