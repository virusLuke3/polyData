import { marketPanelRenderers } from '../../market-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(marketPanelRenderers, {
  id: 'price-implications',
  title: 'AI Market Insights',
  eyebrow: 'agent',
  description: 'Agent-generated market brief, focus signals, and evidence.',
  defaultEnabled: true,
});
