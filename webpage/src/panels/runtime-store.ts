import type { PanelModule, PanelRefreshTier, PanelRuntimeData } from './types';

export function buildRuntimeDataPatch(panelId: string, value: unknown): PanelRuntimeData {
  return { [panelId]: value };
}

export function getRefreshablePanels(panels: PanelModule[], tier: PanelRefreshTier): PanelModule[] {
  return panels.filter((panel) => panel.refresh?.tier === tier && typeof panel.fetchData === 'function');
}

export async function fetchPanelRuntimeData(
  panels: PanelModule[],
  onPanelData?: (panelId: string, value: unknown) => void,
): Promise<PanelRuntimeData> {
  const entries = panels.filter((panel) => typeof panel.fetchData === 'function');
  const patch: PanelRuntimeData = {};
  await Promise.all(entries.map(async (panel) => {
    try {
      const value = await panel.fetchData!();
      patch[panel.id] = value;
      onPanelData?.(panel.id, value);
    } catch {
      // Runtime panels are opportunistic; keep the last visible seed on transient misses.
    }
  }));
  return patch;
}

export function mergeRuntimeData(current: PanelRuntimeData, patch: PanelRuntimeData): PanelRuntimeData {
  if (!Object.keys(patch).length) return current;
  const next = { ...current };
  for (const [panelId, value] of Object.entries(patch)) {
    const previous = current[panelId];
    if (panelId === 'global-temperature-monitor' && hasItems(previous) && isEmptyWarming(value)) {
      continue;
    }
    next[panelId] = value;
  }
  return next;
}

function hasItems(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { items?: unknown[] }).items) &&
    ((value as { items?: unknown[] }).items?.length || 0) > 0,
  );
}

function isEmptyWarming(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value as { items?: unknown[]; status?: unknown };
  return (!Array.isArray(payload.items) || payload.items.length === 0) && String(payload.status || '').toLowerCase() === 'warming';
}
