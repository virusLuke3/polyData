import { chainPanelRenderers } from '../../chain-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(chainPanelRenderers, {
  id: 'sample-chain-trades',
  title: 'AI Flow Insights',
  eyebrow: 'agent',
  description: 'Market-wide AI readout of trade flow, whales, and liquidity.',
  defaultEnabled: true,
});
