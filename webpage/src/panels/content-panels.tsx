import { Panel } from '@/components/Panel';
import { useMemo, useState } from 'preact/hooks';
import type { PanelRenderMap, PanelRuntimeContext } from './types';
import { contentList } from './shared/renderers';
import { contentByType, focusedContent } from './shared/selectors';

type IntelTab = {
  id: 'news' | 'video' | 'report' | 'research';
  label: string;
};

const INTEL_TABS: IntelTab[] = [
  { id: 'news', label: 'News' },
  { id: 'video', label: 'Video' },
  { id: 'report', label: 'Reports' },
  { id: 'research', label: 'Research' },
];

function RelatedIntelPanel({ ctx }: { ctx: PanelRuntimeContext }) {
  const [activeTab, setActiveTab] = useState<IntelTab['id']>('news');
  const items = focusedContent(ctx);
  const tabItems = useMemo(() => Object.fromEntries(
    INTEL_TABS.map((tab) => [tab.id, contentByType(items, tab.id)]),
  ) as Record<IntelTab['id'], ReturnType<typeof contentByType>>, [items]);
  const visibleItems = tabItems[activeTab] || [];
  const activeLabel = INTEL_TABS.find((tab) => tab.id === activeTab)?.label || 'Intel';

  return (
    <Panel
      title="RELATED INTEL"
      badge={ctx.bundle?.content?.sourceMode || 'runtime-rss'}
      status="live"
      count={items.length}
      className="wm-market-panel wm-content-feed-panel wm-related-news-panel wm-related-intel-panel"
    >
      <div className="wm-intel-filter-tabs" role="tablist" aria-label="Related intel content types">
        {INTEL_TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            <b>{tabItems[tab.id]?.length || 0}</b>
          </button>
        ))}
      </div>
      {contentList(visibleItems, `No ${activeLabel.toLowerCase()} intel for this market yet.`)}
    </Panel>
  );
}

export const contentPanelRenderers: PanelRenderMap = {
  'related-news': {
    render: (ctx) => <RelatedIntelPanel ctx={ctx} />,
  },
  'related-video': {
    render: (ctx) => (
      <Panel title="VIDEO FEED" badge="VIDEO" status="muted" count={contentByType(focusedContent(ctx), 'video').length} className="wm-market-panel wm-content-feed-panel wm-related-video-panel">
        {contentList(contentByType(focusedContent(ctx), 'video'), 'No linked videos yet.')}
      </Panel>
    ),
  },
  'report-feed': {
    render: (ctx) => (
      <Panel title="REPORT FEED" badge="REPORT" status="muted" count={contentByType(ctx.latestContent, 'report').length} className="wm-market-panel wm-content-feed-panel wm-report-feed-panel">
        {contentList(contentByType(ctx.latestContent, 'report'), 'No linked reports yet.')}
      </Panel>
    ),
  },
  'research-feed': {
    render: (ctx) => (
      <Panel title="RESEARCH FEED" badge="RESEARCH" status="muted" count={contentByType(ctx.latestContent, 'research').length} className="wm-market-panel wm-content-feed-panel wm-research-feed-panel">
        {contentList(contentByType(ctx.latestContent, 'research'), 'No linked research yet.')}
      </Panel>
    ),
  },
};
