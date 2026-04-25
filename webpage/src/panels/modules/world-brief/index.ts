import { briefPanelRenderers } from '../../brief-panels';
import { panelFromRenderer } from '../helpers';

export const panel = panelFromRenderer(briefPanelRenderers, {
  id: 'world-brief',
  title: 'World Brief',
  eyebrow: 'context',
  description: 'Selected market narrative and context.',
  defaultEnabled: true,
});
