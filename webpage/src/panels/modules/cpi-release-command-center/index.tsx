import { fetchRuntimeCpiReleaseCommandCenter } from '@/services/api';
import type { RuntimeMacroRegistryPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { MacroRegistryPanel } from '../macro-registry-panel';

const renderers: PanelRenderMap = {
  'cpi-release-command-center': {
    render: (ctx) => (
      <MacroRegistryPanel
        config={{
          panelId: 'cpi-release-command-center',
          title: 'CPI RELEASE COMMAND',
          badge: 'OFFICIAL',
          glyph: 'calendar',
          helpTitle: 'CPI Release Command Center',
          helpText: 'Combines official CPI/PCE/FOMC/NFP calendars with seeded Cleveland Fed nowcast rows. Polymarket markets are used only as design reference, not as runtime data.',
          emptyTitle: 'CPI RELEASE WARMING',
          implicationItems: ['CPI print timing', 'Core CPI threshold', 'PCE bridge', 'Fed reaction window'],
        }}
        payload={ctx.runtimeData['cpi-release-command-center'] as RuntimeMacroRegistryPayload | undefined}
      />
    ),
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'cpi-release-command-center',
  title: 'CPI Release Command Center',
  eyebrow: 'macro',
  description: 'Official release calendar plus nowcast registry for CPI/PCE/Fed timing.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeCpiReleaseCommandCenter(36),
});
