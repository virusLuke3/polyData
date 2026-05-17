import { Panel } from '@/components/Panel';
import type { PanelRenderMap } from './types';
import { contentList } from './shared/renderers';
import { contentByType, fallbackContent, focusedContent } from './shared/selectors';

export const contentPanelRenderers: PanelRenderMap = {
  'related-news': {
    render: (ctx) => (
      <Panel title="RELATED NEWS" badge={ctx.bundle?.content?.sourceMode || 'runtime-rss'} status="live" count={focusedContent(ctx).length} className="wm-market-panel wm-content-feed-panel wm-related-news-panel">
        {contentList(focusedContent(ctx), 'No linked articles yet.')}
      </Panel>
    ),
  },
  'related-video': {
    render: (ctx) => (
      <Panel title="VIDEO FEED" badge="VIDEO" status="muted" count={contentByType(focusedContent(ctx), 'video').length} className="wm-market-panel wm-content-feed-panel wm-related-video-panel">
        {contentList(fallbackContent(focusedContent(ctx), 'video'), 'No linked videos yet.')}
      </Panel>
    ),
  },
  'report-feed': {
    render: (ctx) => (
      <Panel title="REPORT FEED" badge="REPORT" status="muted" count={contentByType(ctx.latestContent, 'report').length} className="wm-market-panel wm-content-feed-panel wm-report-feed-panel">
        {contentList(fallbackContent(ctx.latestContent, 'report'), 'No linked reports yet.')}
      </Panel>
    ),
  },
  'research-feed': {
    render: (ctx) => (
      <Panel title="RESEARCH FEED" badge="RESEARCH" status="muted" count={contentByType(ctx.latestContent, 'research').length} className="wm-market-panel wm-content-feed-panel wm-research-feed-panel">
        {contentList(fallbackContent(ctx.latestContent, 'research'), 'No linked research yet.')}
      </Panel>
    ),
  },
};
