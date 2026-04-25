import type { VNode } from 'preact';
import type { PanelDefinition, PanelRenderContext } from '@/types';

export type PanelRuntimeData = Record<string, unknown>;

export type PanelRuntimeContext = PanelRenderContext & {
  runtimeData: PanelRuntimeData;
};

export type PanelRenderer = (ctx: PanelRuntimeContext) => VNode;

export type RegistryEntry = PanelDefinition & {
  render: PanelRenderer;
  defaultEnabled?: boolean;
  refresh?: PanelRefreshConfig;
  fetchData?: PanelFetchData;
};

export type PanelEntryFragment = {
  render: PanelRenderer;
  size?: PanelDefinition['size'];
};

export type PanelRenderMap = Record<string, PanelEntryFragment>;

export type PanelRefreshTier = 'bootstrap' | 'fast' | 'slow' | 'manual';

export type PanelRefreshConfig = {
  tier: PanelRefreshTier;
  intervalMs?: number;
};

export type PanelFetchData = () => Promise<unknown>;

export type PanelModule = PanelDefinition & {
  defaultEnabled?: boolean;
  refresh?: PanelRefreshConfig;
  fetchData?: PanelFetchData;
  render: PanelRenderer;
};
