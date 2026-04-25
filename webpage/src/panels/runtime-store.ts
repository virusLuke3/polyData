import type { PanelModule, PanelRefreshTier, PanelRuntimeData } from './types';

export function buildRuntimeDataPatch(panelId: string, value: unknown): PanelRuntimeData {
  return { [panelId]: value };
}

export function getRefreshablePanels(panels: PanelModule[], tier: PanelRefreshTier): PanelModule[] {
  return panels.filter((panel) => panel.refresh?.tier === tier && typeof panel.fetchData === 'function');
}

export async function fetchPanelRuntimeData(panels: PanelModule[]): Promise<PanelRuntimeData> {
  const entries = panels.filter((panel) => typeof panel.fetchData === 'function');
  const settled = await Promise.allSettled(entries.map((panel) => panel.fetchData!()));
  const patch: PanelRuntimeData = {};
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      patch[entries[index]!.id] = result.value;
    }
  });
  return patch;
}

export function mergeRuntimeData(current: PanelRuntimeData, patch: PanelRuntimeData): PanelRuntimeData {
  if (!Object.keys(patch).length) return current;
  return { ...current, ...patch };
}
