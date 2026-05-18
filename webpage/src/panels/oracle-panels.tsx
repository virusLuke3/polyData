import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from './types';
import { oracleList } from './shared/renderers';
import { focusedOracle, globalOracle } from './shared/selectors';

export const oraclePanelRenderers: PanelRenderMap = {
  'oracle-feed': {
    render: (ctx) => (
      <Panel title="ORACLE FEED" badge="LIVE" status="live" count={globalOracle(ctx).length} className="wm-oracle-feed-panel">
        {oracleList(globalOracle(ctx), 10, 'feed')}
      </Panel>
    ),
  },
  'oracle-timeline': {
    render: (ctx) => (
      <Panel title="ORACLE TIMELINE" badge="MARKET" status="live" count={focusedOracle(ctx).length} className="wm-oracle-timeline-panel">
        {oracleList(focusedOracle(ctx), 12, 'timeline')}
      </Panel>
    ),
  },
};
