import { oraclePanelRenderers } from '../../oracle-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(oraclePanelRenderers, {
  id: 'oracle-timeline',
  title: 'AI Oracle Insights',
  eyebrow: 'agent',
  description: 'Market-wide AI readout of oracle activity and settlement risk.',
  defaultEnabled: true,
});
