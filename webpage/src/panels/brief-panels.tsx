import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from './types';

export const briefPanelRenderers: PanelRenderMap = {
  'world-brief': {
    render: (ctx) => (
      <Panel title="WORLD BRIEF" badge="LIVE" status="live">
        <div className="wm-brief-card">
          <div className="wm-brief-label">FEATURED CONTEXT</div>
          <div className="wm-brief-copy">
            {ctx.selectedMarket?.description || 'Select a live market to inspect chain activity, oracle state, runtime LOB, and linked intelligence.'}
          </div>
        </div>
      </Panel>
    ),
  },
};

