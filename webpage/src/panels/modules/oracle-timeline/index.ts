import { oraclePanelRenderers } from '../../oracle-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(oraclePanelRenderers, {
  id: 'oracle-timeline',
  title: 'Oracle Timeline',
  eyebrow: 'oracle',
  description: 'Focused market oracle timeline.',
  defaultEnabled: true,
});
