import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeGridEsports } from '@/services/api';
import type { RuntimeGridEsportsItem, RuntimeGridEsportsPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

type SortMode = 'state' | 'start' | 'momentum';

function numeric(value?: number | string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stateRank(value?: string | null) {
  if (value === 'live') return 0;
  if (value === 'pending-state') return 1;
  if (value === 'upcoming') return 2;
  if (value === 'finished') return 3;
  return 4;
}

function sourceStatus(payload?: RuntimeGridEsportsPayload | null) {
  const sources = payload?.sources || {};
  if (sources.gridCentralData === 'missing-key') return 'missing-key';
  if (payload?.status === 'ok') return 'ok';
  if (payload?.status === 'empty') return 'empty';
  return payload?.status || 'warming';
}

function statusBadge(status?: string | null) {
  if (status === 'live') return 'LIVE';
  if (status === 'finished') return 'FINAL';
  if (status === 'upcoming') return 'NEXT';
  if (status === 'pending-state') return 'PENDING';
  return 'GRID';
}

function statusClass(status?: string | null) {
  if (status === 'live') return 'live';
  if (status === 'finished') return 'final';
  if (status === 'upcoming') return 'next';
  return 'watch';
}

function pmLabel(item: RuntimeGridEsportsItem) {
  const pm = item.pm;
  if (!pm || pm.status === 'not-matched') return 'NO PM';
  if (pm.status === 'error') return 'PM ERR';
  const probability = Number(pm.probability);
  if (Number.isFinite(probability)) return `${Math.round(probability * 100)}% PM`;
  return pm.signal || 'PM';
}

function startLabel(value?: string | null) {
  if (!value) return '--';
  return formatRelative(value).replace(' ago', '').replace('in ', '');
}

function compactText(value?: string | null, maxLength = 30) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trim()}...`;
}

function sortItems(items: RuntimeGridEsportsItem[], sortMode: SortMode) {
  const copy = [...items];
  if (sortMode === 'momentum') {
    return copy.sort((left, right) => Math.abs(numeric(right.momentum) - 50) - Math.abs(numeric(left.momentum) - 50));
  }
  if (sortMode === 'start') {
    return copy.sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')));
  }
  return copy.sort((left, right) => stateRank(left.state) - stateRank(right.state) || String(left.startTime || '').localeCompare(String(right.startTime || '')));
}

function nextSortMode(current: SortMode): SortMode {
  if (current === 'state') return 'start';
  if (current === 'start') return 'momentum';
  return 'state';
}

function topSignal(payload?: RuntimeGridEsportsPayload | null, items: RuntimeGridEsportsItem[] = []) {
  const status = sourceStatus(payload);
  if (status === 'missing-key') return 'GRID key missing from runtime environment';
  if (!items.length) return 'No GRID series in the configured window';
  const live = items.filter((item) => item.state === 'live').length;
  const pmLinked = Number(payload?.summary?.pmLinked || 0);
  if (live > 0) return `${live} live GRID state ${live === 1 ? 'feed' : 'feeds'}`;
  if (pmLinked > 0) return `${pmLinked} PMKT-linked GRID series`;
  return `${items.length} GRID series ready`;
}

function EsportsSummary({ payload, items }: { payload?: RuntimeGridEsportsPayload | null; items: RuntimeGridEsportsItem[] }) {
  const summary = payload?.summary || {};
  return (
    <div className="wm-esports-summary">
      <div className="wm-esports-hero-icon">GRID</div>
      <div className="wm-esports-hero-main">
        <strong>{topSignal(payload, items)}</strong>
        <span>
          <em>OFFICIAL</em>
          <em>{(payload?.cacheMode || 'live-build').toUpperCase()}</em>
          <em>{payload?.generatedAt ? startLabel(payload.generatedAt) : '--'}</em>
        </span>
      </div>
      <div className="wm-esports-hero-metrics">
        <span>Series <strong>{summary.visibleSeries ?? items.length}</strong></span>
        <span>State <strong>{summary.officialSnapshots ?? 0}</strong></span>
        <span>PMKT <strong>{summary.pmLinked ?? 0}</strong></span>
      </div>
    </div>
  );
}

function TeamMetric({ item }: { item: RuntimeGridEsportsItem }) {
  const metrics = item.teamMetrics || [];
  const left = metrics[0] || {};
  const right = metrics[1] || {};
  return (
    <div className="wm-esports-metric-strip">
      <span>{item.score || '--'}</span>
      <span>K {numeric(left.kills)}:{numeric(right.kills)}</span>
      <span>D {numeric(left.deaths)}:{numeric(right.deaths)}</span>
    </div>
  );
}

function EsportsRow({ item, index }: { item: RuntimeGridEsportsItem; index: number }) {
  const momentum = Math.round(numeric(item.momentum || 50));
  const side = momentum >= 50 ? 'a' : 'b';
  return (
    <article className={`wm-esports-row state-${statusClass(item.state)} side-${side}`}>
      <div className="wm-esports-row-glyph">{item.gameTitle?.slice(0, 3) || 'ESP'}</div>
      <div className="wm-esports-row-main">
        <div className="wm-esports-row-top">
          <strong title={item.series || 'TBD vs TBD'}>{compactText(item.series || 'TBD vs TBD', 18)}</strong>
          <span className={`wm-esports-status-badge state-${statusClass(item.state)}`}>{statusBadge(item.state)}</span>
        </div>
        <div className="wm-esports-row-meta">
          <span>{String(index + 1).padStart(2, '0')}</span>
          <span title={item.tournament || 'GRID Tournament'}>{compactText(item.tournament || 'GRID Tournament', 14)}</span>
          <span>{startLabel(item.startTime)}</span>
        </div>
        <div className="wm-esports-tags">
          {(item.contextTags || []).slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
        </div>
      </div>
      <TeamMetric item={item} />
      <div className="wm-esports-right-rail">
        <span className="wm-esports-momentum">{momentum}</span>
        <span className="wm-esports-pm">{pmLabel(item)}</span>
      </div>
    </article>
  );
}

function EsportsList({ payload, sortMode }: { payload?: RuntimeGridEsportsPayload | null; sortMode: SortMode }) {
  const items = useMemo(() => sortItems(payload?.items || [], sortMode), [payload, sortMode]);
  if (!items.length) {
    return (
      <div className="wm-esports-empty-state">
        <span>{sourceStatus(payload).toUpperCase()}</span>
        <strong>GRID esports feed is warming.</strong>
        <em>Central Data and Series State will render here after the watcher seeds a snapshot.</em>
      </div>
    );
  }
  return (
    <div className="wm-esports-table">
      {items.map((item, index) => <EsportsRow key={item.id || index} item={item} index={index} />)}
    </div>
  );
}

function EsportsIntelPanel({ payload }: { payload?: RuntimeGridEsportsPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('state');
  const items = payload?.items || [];
  const degraded = sourceStatus(payload) !== 'ok';

  return (
    <Panel
      title="ESPORTS INTEL"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain GRID esports intelligence"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={degraded ? 'CACHED' : 'LIVE'}
      status={degraded ? 'muted' : 'live'}
      count={items.length}
      controls={(
        <button
          type="button"
          className="wm-panel-action-button"
          aria-label={`Sort esports series by ${nextSortMode(sortMode)}`}
          onClick={() => setSortMode((current) => nextSortMode(current))}
        >
          {sortMode.toUpperCase()}
        </button>
      )}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>GRID Esports Intel</strong>
          <p>Uses GRID Open Access Central Data for series discovery and Series State for official in-game context. PMKT badges are local Polymarket match candidates, not sportsbook odds.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-esports-panel"
      dataPanelId="esports-intel"
    >
      <EsportsSummary payload={payload} items={items} />
      <EsportsList payload={payload} sortMode={sortMode} />
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'esports-intel': {
    render: (ctx) => {
      const payload = ctx.runtimeData['esports-intel'] as RuntimeGridEsportsPayload | undefined;
      return <EsportsIntelPanel payload={payload} />;
    },
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'esports-intel',
  title: 'Esports Intel',
  eyebrow: 'sports',
  description: 'GRID official esports series state with local Polymarket matching context.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 30000,
  fetchData: () => fetchRuntimeGridEsports(3),
});
