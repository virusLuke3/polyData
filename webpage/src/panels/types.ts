import type { VNode } from 'preact';
import type { PanelDefinition, PanelRenderContext } from '@/types';

export type PanelRenderer = (ctx: PanelRenderContext) => VNode;

export type RegistryEntry = PanelDefinition & {
  render: PanelRenderer;
};

export type PanelEntryFragment = {
  render: PanelRenderer;
  size?: PanelDefinition['size'];
};

export type PanelRenderMap = Record<string, PanelEntryFragment>;
