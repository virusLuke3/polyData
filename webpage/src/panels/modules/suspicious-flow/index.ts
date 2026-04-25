import { fetchRuntimeSuspicious } from '@/services/api';
import { chainPanelRenderers } from '../../chain-panels';
import { runtimePanelFromRenderer } from '../helpers';

export const panel = runtimePanelFromRenderer(chainPanelRenderers, {
  id: 'suspicious-flow',
  title: 'Suspicious Flow',
  eyebrow: 'chain',
  description: 'Pre-oracle or unusual trade flow.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeSuspicious(12),
});
