import { fetchRuntimeInflationNowcast } from '@/services/api';
import { macroPanelRenderers } from '../../macro-panels';
import { runtimePanelFromRenderer } from '../helpers';

export const panel = runtimePanelFromRenderer(macroPanelRenderers, {
  id: 'inflation-nowcast',
  title: 'Inflation Nowcast',
  eyebrow: 'macro',
  description: 'Cleveland Fed CPI/PCE nowcasting panel.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: fetchRuntimeInflationNowcast,
});
