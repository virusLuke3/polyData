import { PANEL_MODULES } from './modules';
import type { PanelModule, RegistryEntry } from './types';

export type { PanelModule, RegistryEntry } from './types';
export { PANEL_MODULES } from './modules';

export const PANEL_LIBRARY = PANEL_MODULES.map(({ render, fetchData, refresh, defaultEnabled, ...definition }) => definition);

function assertUniquePanelIds(panels: PanelModule[]) {
  const seen = new Set<string>();
  for (const panel of panels) {
    if (seen.has(panel.id)) {
      throw new Error(`Duplicate panel module id: ${panel.id}`);
    }
    seen.add(panel.id);
    if (panel.fetchData && !panel.refresh?.tier) {
      throw new Error(`Runtime panel ${panel.id} must declare refresh.tier`);
    }
  }
}

assertUniquePanelIds(PANEL_MODULES);

export const DEFAULT_PANEL_IDS = PANEL_MODULES
  .filter((panel) => panel.defaultEnabled !== false)
  .map((panel) => panel.id);

export const RUNTIME_PANEL_MODULES = PANEL_MODULES.filter((panel) => typeof panel.fetchData === 'function');

export const PANEL_REGISTRY: Record<string, RegistryEntry> = Object.fromEntries(
  PANEL_MODULES.map((panel) => [panel.id, panel]),
);
