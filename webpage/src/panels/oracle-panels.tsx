import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from './types';
import { AiMarketWidePanel } from './shared/ai-market-wide';
import { oracleList } from './shared/renderers';
import { globalOracle } from './shared/selectors';

export const oraclePanelRenderers: PanelRenderMap = {
  'oracle-feed': {
    render: (ctx) => (
      <Panel title="ORACLE FEED" badge="LIVE" status="live" count={globalOracle(ctx).length} className="wm-oracle-feed-panel">
        {oracleList(globalOracle(ctx), 10)}
      </Panel>
    ),
  },
  'oracle-timeline': {
    render: (ctx) => (
      <AiMarketWidePanel ctx={ctx} lens="oracle" title="AI ORACLE INSIGHTS" badge="ORACLE" />
    ),
  },
};
