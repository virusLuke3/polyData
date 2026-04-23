import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { RuntimeJin10Item } from '@/types';
import type { PanelRenderMap } from './types';
import { formatRelative } from './shared/formatters';
import { emptyState } from './shared/renderers';

type Jin10Filter = 'impact' | 'latest' | 'vip';

function filterItems(items: RuntimeJin10Item[], filter: Jin10Filter) {
  const sorted = [...items].sort(
    (left, right) =>
      new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime(),
  );
  if (filter === 'vip') return sorted.filter((item) => item.locked);
  if (filter === 'impact') {
    return sorted.filter((item) => item.important || (item.assetHints || []).length > 0 || !item.locked);
  }
  return sorted;
}

function cardTopic(item: RuntimeJin10Item) {
  return item.assetHints?.[0] || item.source || 'jin10';
}

function cardMode(item: RuntimeJin10Item) {
  if (item.locked) return 'vip';
  if (item.important) return 'impact';
  return 'live';
}

function cardStatus(item: RuntimeJin10Item) {
  if (item.locked) return 'locked';
  return item.important ? 'high impact' : 'public';
}

function cardMarker(item: RuntimeJin10Item) {
  if (item.locked) return 'VIP';
  return item.important ? 'HOT' : 'LIVE';
}

function jin10CardList(items: RuntimeJin10Item[]) {
  if (!items.length) return emptyState('No Jin10 panel data loaded yet.');
  return (
    <div className="wm-jin10-market-list">
      {items.map((item) => (
        <a
          className={`wm-jin10-card is-${cardMode(item)}`}
          href={item.url || '#'}
          target="_blank"
          rel="noreferrer"
          key={item.id}
          title={item.headline || 'Jin10 flash'}
        >
          <div className="wm-jin10-card-main">
            <div className="wm-jin10-card-meta">
              <span className="wm-jin10-card-dot" />
              <span>{cardTopic(item)}</span>
              <span>·</span>
              <span>{formatRelative(item.timestamp || null)}</span>
              <span>·</span>
              <span>{cardStatus(item)}</span>
            </div>
            <strong className="wm-jin10-card-title">{item.headline || 'Jin10 update'}</strong>
            {item.summary ? <div className="wm-jin10-card-summary">{item.summary}</div> : null}
            <div className="wm-jin10-card-bottom">
              <span className="wm-jin10-card-primary">{item.important ? 'macro pulse' : 'wire flow'}</span>
              <span className="wm-jin10-card-secondary">{item.source || 'Jin10'}</span>
              {item.assetHints?.[1] ? <span className="wm-jin10-card-tertiary">{item.assetHints[1]}</span> : null}
              <span className="wm-jin10-card-quaternary">{cardMarker(item)}</span>
            </div>
          </div>
          <span className="wm-jin10-card-marker" aria-hidden="true">{cardMarker(item)}</span>
        </a>
      ))}
    </div>
  );
}

function Jin10FlashPanel({ items }: { items: RuntimeJin10Item[] }) {
  const [filter, setFilter] = useState<Jin10Filter>('impact');
  const visibleItems = useMemo(() => filterItems(items, filter), [items, filter]);

  return (
    <Panel
      title="JIN10"
      badge="LIVE"
      status="live"
      count={visibleItems.length}
      className="wm-market-panel wm-jin10-panel"
      controls={(
        <select
          className="wm-market-sort wm-jin10-sort"
          value={filter}
          onInput={(event) => setFilter(event.currentTarget.value as Jin10Filter)}
          aria-label="Filter Jin10 feed"
        >
          <option value="impact">Impact</option>
          <option value="latest">Latest</option>
          <option value="vip">VIP</option>
        </select>
      )}
    >
      {jin10CardList(visibleItems)}
    </Panel>
  );
}

export const jin10PanelRenderers: PanelRenderMap = {
  'jin10-flash': {
    render: (ctx) => <Jin10FlashPanel items={ctx.jin10?.items || []} />,
  },
};
