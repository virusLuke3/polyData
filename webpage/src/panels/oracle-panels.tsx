import { Panel } from '@/components/Panel';
import type { OraclePayload, PanelRenderContext } from '@/types';
import type { PanelRenderMap } from './types';
import { AiMarketWidePanel } from './shared/ai-market-wide';
import { oracleList } from './shared/renderers';
import { formatRelative, shortHash } from './shared/formatters';
import { globalOracle } from './shared/selectors';

function focusedOraclePayload(ctx: PanelRenderContext): OraclePayload | null {
  if (ctx.selectedMarketId && ctx.bundle?.oracle) {
    const oracleMarketId = Number(ctx.bundle.oracle.localMarketId ?? ctx.bundle.oracle.marketId);
    if (Number.isFinite(oracleMarketId) && oracleMarketId === Number(ctx.selectedMarketId)) {
      return ctx.bundle.oracle;
    }
  }
  const selectedGroup = ctx.selectedMarketGroupDetail || ctx.bundle?.group || ctx.selectedMarketGroup;
  const selectedOutcome = (
    ctx.bundle?.selectedOutcome && ctx.selectedMarketId != null && Number(ctx.bundle.selectedOutcome.marketId) === ctx.selectedMarketId
      ? ctx.bundle.selectedOutcome
      : null
  ) || (
    (selectedGroup?.outcomes || []).find((outcome) => ctx.selectedMarketId != null && Number(outcome.marketId) === ctx.selectedMarketId)
    || (selectedGroup?.topOutcomes || []).find((outcome) => ctx.selectedMarketId != null && Number(outcome.marketId) === ctx.selectedMarketId)
    || (selectedGroup?.outcomes || []).find((outcome) => outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
    || (selectedGroup?.topOutcomes || []).find((outcome) => outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
    || null
  );
  if (!selectedOutcome && !ctx.selectedMarketId) return null;
  return {
    marketId: Number(selectedOutcome?.marketId || ctx.selectedMarketId || 0),
    localMarketId: selectedOutcome?.marketId ?? ctx.selectedMarketId ?? null,
    gammaMarketId: selectedOutcome?.gammaMarketId ?? ctx.bundle?.market?.gammaMarketId ?? ctx.selectedMarket?.gammaMarketId ?? null,
    conditionId: selectedOutcome?.conditionId ?? ctx.selectedMarket?.conditionId ?? ctx.bundle?.market?.conditionId ?? null,
    questionId: ctx.selectedMarket?.questionId ?? ctx.bundle?.market?.questionId ?? null,
    oracle: ctx.selectedMarket?.oracle ?? ctx.bundle?.market?.oracle ?? null,
    currentStatus: ctx.selectedMarket?.status ?? 'OPEN',
    completionStatus: 'OPEN',
    isTradingClosed: false,
    isResolved: false,
    isFinal: false,
    settlementOutcome: 'UNKNOWN',
    settlementSource: selectedOutcome?.marketId ? 'market' : 'gamma-event',
    timeline: [],
  };
}

function focusedOracleStatus(ctx: PanelRenderContext, payload: OraclePayload) {
  const marketTitle = ctx.bundle?.market?.title || ctx.selectedMarket?.title || ctx.bundle?.group?.title || ctx.selectedMarketGroupDetail?.title || ctx.selectedMarketGroup?.title || 'Selected market';
  const status = payload.completionStatus || (payload.isFinal ? 'SETTLED' : payload.isTradingClosed ? 'CLOSED' : 'OPEN');
  const outcome = payload.settlementOutcome && payload.settlementOutcome !== 'UNKNOWN' ? payload.settlementOutcome : 'Awaiting oracle';
  const bookStatus = String(ctx.bundle?.lob?.bookStatus || '').toLowerCase();
  const hasLiveBook = Boolean(
    (ctx.bundle?.lob?.yes?.asks || []).length
      || (ctx.bundle?.lob?.yes?.bids || []).length
      || (ctx.bundle?.lob?.no?.asks || []).length
      || (ctx.bundle?.lob?.no?.bids || []).length,
  );
  const tradingText = payload.isTradingClosed
    ? 'Trading closed'
    : bookStatus === 'no-book' || (!hasLiveBook && ctx.bundle?.lob)
      ? 'No live CLOB book'
      : 'Oracle open';
  return (
    <div className="wm-oracle-shell focused">
      <div className="wm-oracle-summary-strip">
        <span><strong>{status}</strong> status</span>
          <span><strong>{payload.questionId || payload.conditionId || payload.gammaMarketId ? 'YES' : 'NO'}</strong> bound</span>
        <span><strong>{payload.timeline?.length || 0}</strong> events</span>
      </div>
      <article className="wm-oracle-event-card focused">
        <div className="wm-oracle-event-top">
          <div className="wm-oracle-stage">
            <span className={`wm-oracle-stage-dot ${payload.isFinal ? 'positive' : payload.isTradingClosed ? 'warning' : 'neutral'}`} aria-hidden="true" />
            <strong>{payload.isFinal ? 'Finalized' : payload.isTradingClosed ? 'Closed, waiting oracle' : 'Market bound'}</strong>
          </div>
          <span className="wm-status-pill neutral">{status}</span>
        </div>
        <div className="wm-oracle-market-title">{marketTitle}</div>
        <div className="wm-oracle-result-row">
          <span className={`wm-oracle-outcome ${String(outcome).toLowerCase()}`}>{outcome}</span>
          <span>{payload.isResolved ? 'RESOLVED' : 'UNRESOLVED'}</span>
          <span>{payload.localMarketId || payload.marketId ? `MKT #${payload.localMarketId || payload.marketId}` : 'NO LOCAL ID'}</span>
        </div>
        <div className="wm-oracle-event-meta">
          <span>{tradingText}</span>
          <span>{formatRelative(ctx.selectedMarket?.endDate || ctx.bundle?.market?.endDate || null)}</span>
        </div>
        <div className="wm-oracle-proof-grid">
          <span>Oracle <strong>{shortHash(payload.oracle || '', 8, 5) || '--'}</strong></span>
          <span>QID <strong>{shortHash(payload.questionId || payload.conditionId || '', 8, 5) || '--'}</strong></span>
          <span>Source <strong>{payload.settlementSource || 'market'}</strong></span>
        </div>
      </article>
    </div>
  );
}

export const oraclePanelRenderers: PanelRenderMap = {
  'oracle-feed': {
    render: (ctx) => {
      const focused = focusedOraclePayload(ctx);
      const events = focused?.timeline?.length ? focused.timeline : globalOracle(ctx);
      return (
        <Panel title={focused ? "ORACLE STATUS" : "ORACLE FEED"} badge={focused ? "BOUND" : "LIVE"} status="live" count={focused ? (focused.timeline?.length || 0) : globalOracle(ctx).length} className="wm-oracle-feed-panel">
          {focused
            ? (focused.timeline?.length ? oracleList(focused.timeline, 10, 'timeline') : focusedOracleStatus(ctx, focused))
            : oracleList(events, 10)}
        </Panel>
      );
    },
  },
  'oracle-timeline': {
    render: (ctx) => (
      <AiMarketWidePanel ctx={ctx} lens="trend" title="TREND WATCH" badge="TREND" />
    ),
  },
};
