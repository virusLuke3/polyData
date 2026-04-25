import { marketPanelRenderers } from '../../market-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(marketPanelRenderers, {
  id: 'featured-market',
  title: 'Featured Market',
  eyebrow: 'focus',
  description: 'Primary market card with key stats.',
  defaultEnabled: true,
});
