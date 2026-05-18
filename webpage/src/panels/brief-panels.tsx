import { Panel } from '@/components/Panel';
import type { MarketGroupOutcome } from '@/types';
import { formatCompact, formatCurrencyCompact, formatDate, formatPercent, formatRelative } from './shared/formatters';
import type { PanelRenderMap } from './types';

function firstFiniteValue(...values: Array<string | number | null | undefined>) {
  return values.find((value) => {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(Number(value));
  }) ?? null;
}

function sumFiniteValues(values: Array<string | number | null | undefined>) {
  const finite = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0);
}

function complementPrice(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, 1 - numeric));
}

function uniqueGroupOutcomes(outcomes: MarketGroupOutcome[]) {
  const seen = new Set<string>();
  return outcomes.filter((outcome, index) => {
    const key = String(outcome.marketId ?? outcome.outcomeKey ?? outcome.gammaMarketId ?? `${outcome.label || 'outcome'}-${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const briefPanelRenderers: PanelRenderMap = {
  'world-brief': {
    render: (ctx) => {
      const market = ctx.selectedMarket || ctx.bundle?.market || ctx.bootstrap?.featuredMarket || null;
      const selectedGroup = ctx.selectedMarketGroupDetail
        || ctx.marketGroups.find((group) => {
          const eventId = group.eventId != null ? String(group.eventId) : null;
          const groupOutcomeMarketIds = [...(group.outcomes || []), ...(group.topOutcomes || [])]
            .map((outcome) => Number(outcome.marketId))
            .filter(Number.isFinite);
          return (eventId && eventId === ctx.selectedMarketGroupId)
            || (ctx.selectedMarketId != null && (Number(group.defaultMarketId) === ctx.selectedMarketId || groupOutcomeMarketIds.includes(ctx.selectedMarketId)));
        })
        || null;
      const selectedOutcome = selectedGroup
        ? ((selectedGroup.outcomes?.length ? selectedGroup.outcomes : selectedGroup.topOutcomes) || []).find((outcome) => (
            (ctx.selectedMarketGroupOutcomeKey && outcome.outcomeKey === ctx.selectedMarketGroupOutcomeKey)
            || (ctx.selectedMarketId != null && Number(outcome.marketId) === ctx.selectedMarketId)
          )) || null
        : null;
      const listMarket = ctx.markets.find((item) => item.id === ctx.selectedMarketId) || null;
      const price = ctx.bundle?.price || ctx.bootstrap?.pricePreview;
      const groupOutcomes = selectedGroup ? uniqueGroupOutcomes([...(selectedGroup.outcomes || []), ...(selectedGroup.topOutcomes || [])]) : [];
      const yesPrice = selectedOutcome?.yesPrice ?? price?.latestYesPrice ?? market?.latestYesPrice ?? price?.latestPrice ?? market?.latestPrice;
      const noPrice = selectedOutcome?.noPrice ?? price?.latestNoPrice ?? market?.latestNoPrice;
      const volume24h = firstFiniteValue(
        selectedOutcome?.volume24h,
        selectedGroup?.volume24h,
        sumFiniteValues(groupOutcomes.map((outcome) => outcome.volume24h)),
        listMarket?.volume24h,
        price?.volume24h,
      );
      const tradeCount24h = firstFiniteValue(
        selectedOutcome?.tradeCount24h,
        selectedGroup?.tradeCount24h,
        sumFiniteValues(groupOutcomes.map((outcome) => outcome.tradeCount24h)),
        listMarket?.tradeCount24h,
        price?.tradeCount24h,
      );
      const endDate = selectedGroup?.endDate || market?.endDate || listMarket?.endDate || null;
      const lastTradeAt = selectedOutcome?.lastTradeAt || listMarket?.lastTradeAt || null;
      const displayNoPrice = noPrice ?? complementPrice(yesPrice);
      return (
        <Panel title="MARKET BRIEF" badge="SNAPSHOT" status="live">
          <div className="wm-brief-shell">
            <div className="wm-brief-card">
              <div className="wm-brief-label">MARKET SNAPSHOT</div>
              <strong className="wm-brief-title">{selectedGroup?.title || market?.title || 'Select a live market to load context.'}</strong>
              <div className="wm-brief-copy wm-brief-action-line">
                <span>YES <strong>{formatPercent(yesPrice)}</strong></span>
                <span>NO <strong>{formatPercent(displayNoPrice)}</strong></span>
                <span>{endDate ? `Ends ${formatRelative(endDate)}` : 'Rolling market'}</span>
              </div>
            </div>
            <div className="wm-brief-metrics">
              <article className="wm-brief-metric">
                <span>24H VOL</span>
                <strong>{formatCurrencyCompact(volume24h)}</strong>
              </article>
              <article className="wm-brief-metric">
                <span>TRADES</span>
                <strong>{formatCompact(tradeCount24h)}</strong>
              </article>
              <article className="wm-brief-metric">
                <span>ENDS</span>
                <strong>{formatDate(endDate)}</strong>
              </article>
              <article className="wm-brief-metric">
                <span>LAST TRADE</span>
                <strong>{lastTradeAt ? formatRelative(lastTradeAt) : '--'}</strong>
              </article>
            </div>
          </div>
        </Panel>
      );
    },
  },
};
