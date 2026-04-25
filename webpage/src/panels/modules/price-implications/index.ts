import { marketPanelRenderers } from '../../market-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(marketPanelRenderers, {
  id: 'price-implications',
  title: 'Price Implications',
  eyebrow: 'price',
  description: 'Latest price and derived trade stats.',
  defaultEnabled: true,
});
