import { PANEL_LIBRARY } from './definitions';
import type { PanelRenderMap, RegistryEntry } from './types';
import { briefPanelRenderers } from './brief-panels';
import { chainPanelRenderers } from './chain-panels';
import { contentPanelRenderers } from './content-panels';
import { f1PanelRenderers } from './f1-panels';
import { jin10PanelRenderers } from './jin10-panels';
import { macroPanelRenderers } from './macro-panels';
import { marketPanelRenderers } from './market-panels';
import { oraclePanelRenderers } from './oracle-panels';
import { signalPanelRenderers } from './signal-panels';
import { sportsPanelRenderers } from './sports-panels';
import { systemPanelRenderers } from './system-panels';

export { PANEL_LIBRARY } from './definitions';
export type { RegistryEntry } from './types';

const PANEL_RENDERERS: PanelRenderMap = {
  ...briefPanelRenderers,
  ...marketPanelRenderers,
  ...chainPanelRenderers,
  ...oraclePanelRenderers,
  ...contentPanelRenderers,
  ...f1PanelRenderers,
  ...jin10PanelRenderers,
  ...systemPanelRenderers,
  ...macroPanelRenderers,
  ...sportsPanelRenderers,
  ...signalPanelRenderers,
};

function buildPanelRegistry(renderers: PanelRenderMap): Record<string, RegistryEntry> {
  return Object.fromEntries(
    PANEL_LIBRARY.map((definition) => {
      const entry = renderers[definition.id];
      if (!entry) {
        throw new Error(`Missing panel renderer for ${definition.id}`);
      }
      return [definition.id, { ...definition, ...entry }];
    }),
  );
}

export const PANEL_REGISTRY = buildPanelRegistry(PANEL_RENDERERS);
