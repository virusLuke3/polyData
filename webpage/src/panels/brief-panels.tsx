import { Panel } from '@/components/Panel';
import { formatCompact, formatPercent, formatRelative } from './shared/formatters';
import type { PanelRenderMap } from './types';

export const briefPanelRenderers: PanelRenderMap = {
  'world-brief': {
    render: (ctx) => {
      const market = ctx.selectedMarket;
      const price = ctx.bundle?.price || ctx.bootstrap?.pricePreview;
      return (
        <Panel title="WORLD BRIEF" badge="LIVE" status="live">
          <div className="wm-brief-shell">
            <div className="wm-brief-card">
              <div className="wm-brief-label">FEATURED CONTEXT</div>
              <strong className="wm-brief-title">{market?.title || 'Select a live market to load context.'}</strong>
              <div className="wm-brief-copy">
                {market?.description || 'Use this panel as the narrative bridge between market structure, oracle flow, runtime LOB, and linked intelligence.'}
              </div>
            </div>
            <div className="wm-brief-metrics">
              <article className="wm-brief-metric">
                <span>STATUS</span>
                <strong>{market?.status || 'standby'}</strong>
              </article>
              <article className="wm-brief-metric">
                <span>YES LAST</span>
                <strong>{formatPercent(price?.latestPrice || market?.latestPrice)}</strong>
              </article>
              <article className="wm-brief-metric">
                <span>24H VOL</span>
                <strong>{formatCompact(price?.volume24h)}</strong>
              </article>
              <article className="wm-brief-metric">
                <span>RESOLVES</span>
                <strong>{market?.endDate ? formatRelative(market.endDate) : '--'}</strong>
              </article>
            </div>
          </div>
        </Panel>
      );
    },
  },
};
