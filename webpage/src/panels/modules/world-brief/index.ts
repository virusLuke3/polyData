import { briefPanelRenderers } from '../../brief-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(briefPanelRenderers, {
  id: 'world-brief',
  title: 'Market Brief',
  eyebrow: 'snapshot',
  description: 'Selected market action summary without repeating resolution context.',
  defaultEnabled: true,
});
