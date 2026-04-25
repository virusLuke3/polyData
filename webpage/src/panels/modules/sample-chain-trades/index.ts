import { chainPanelRenderers } from '../../chain-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(chainPanelRenderers, {
  id: 'sample-chain-trades',
  title: 'Market Tape',
  eyebrow: 'chain',
  description: 'Focused market trade tape.',
  defaultEnabled: true,
});
