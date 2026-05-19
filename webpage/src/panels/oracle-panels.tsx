import { Panel } from '@/components/Panel';
import type { OraclePayload, PanelRenderContext } from '@/types';
import type { PanelRenderMap } from './types';
import { AiMarketWidePanel } from './shared/ai-market-wide';
import { oracleList } from './shared/renderers';
import { formatRelative, shortHash } from './shared/formatters';
import { globalOracle } from './shared/selectors';

function focusedOraclePayload(ctx: PanelRenderContext): OraclePayload | null {
  if (ctx.selectedMarketId && ctx.bundle?.oracle) return ctx.bundle.oracle;
  const selectedGroup = ctx.selectedMarketGroupDetail || ctx.selectedMarketGroup;
  const selectedOutcome = (
    (selectedGroup?.outcomes || []).find((outcome) => outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
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
  const marketTitle = ctx.selectedMarket?.title || ctx.bundle?.market?.title || ctx.selectedMarketGroupDetail?.title || ctx.selectedMarketGroup?.title || 'Selected market';
  const status = payload.completionStatus || (payload.isFinal ? 'SETTLED' : payload.isTradingClosed ? 'CLOSED' : 'OPEN');
  const outcome = payload.settlementOutcome && payload.settlementOutcome !== 'UNKNOWN' ? payload.settlementOutcome : 'Awaiting oracle';
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
          <span>{payload.isTradingClosed ? 'Trading closed' : 'Trading open'}</span>
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
