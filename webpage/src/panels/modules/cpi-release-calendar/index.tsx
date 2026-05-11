import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeCpiReleaseCalendar } from '@/services/api';
import type { RuntimeCpiCalendarItem, RuntimeCpiReleaseCalendarPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'OFFICIAL';
  if (normalized === 'degraded') return 'PARTIAL';
  if (normalized === 'warming') return 'WARMING';
  return 'STALE';
}

function panelTone(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

function eventKindLabel(kind?: string | null) {
  const value = String(kind || '').toLowerCase();
  if (value === 'cpi') return 'CPI';
  if (value === 'pce') return 'PCE';
  if (value === 'nfp') return 'NFP';
  if (value === 'fomc') return 'FOMC';
  return 'MACRO';
}

function dateLabel(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
    hour12: false,
  }).format(date);
}

function probabilityLabel(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${Math.round(numeric * 100)}%`;
}

function compactHours(value?: string | number | null) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '--';
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function EventMini({ label, item }: { label: string; item?: RuntimeCpiCalendarItem | null }) {
  return (
    <div className="wm-cpi-calendar-mini">
      <span>{label}</span>
      <strong>{item ? dateLabel(item.releaseAt) : '--'}</strong>
      <em>{item?.referencePeriod || item?.title || 'No upcoming release'}</em>
    </div>
  );
}

function EventRow({ item }: { item: RuntimeCpiCalendarItem }) {
  return (
    <div className={`wm-cpi-calendar-row ${String(item.kind || '').toLowerCase()}`}>
      <div className="wm-cpi-calendar-row-time">
        <span>{eventKindLabel(item.kind)}</span>
        <strong>{dateLabel(item.releaseAt)}</strong>
      </div>
      <div className="wm-cpi-calendar-row-main">
        <strong>{item.title || 'Macro release'}</strong>
        <div>
          <span>{item.referencePeriod || 'Reference period pending'}</span>
          <span>/</span>
          <span>{item.marketRelevance || 'Macro market relevance'}</span>
        </div>
      </div>
      <em>{formatRelative(item.releaseAt)}</em>
    </div>
  );
}

function CpiReleaseCalendarPanel({ payload }: { payload?: RuntimeCpiReleaseCalendarPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const summary = payload?.summary;
  const items = payload?.items || [];
  return (
    <Panel
      title="CPI CALENDAR"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain CPI calendar baseline"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={badgeLabel(payload?.status)}
      status={panelTone(payload?.status)}
      count={items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>CPI Calendar</strong>
          <p>Tracks official BLS, BEA, and Fed release times, then anchors the panel to the top CPI market outcome from the macro map. Consensus is optional and not assumed.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-cpi-calendar-panel"
      dataPanelId="cpi-release-calendar"
    >
      <div className={`wm-cpi-calendar-hero ${summary?.risk || 'unknown'}`}>
        <div>
          <span>Signal</span>
          <strong>{summary?.signal || 'CALENDAR WARMING'}</strong>
        </div>
        <div>
          <span>Time To Event</span>
          <strong>{compactHours(summary?.hoursToEvent)}</strong>
        </div>
        <div>
          <span>PMKT Baseline</span>
          <strong>{probabilityLabel(summary?.baselineProbability)}</strong>
        </div>
      </div>
      <div className="wm-cpi-calendar-mini-grid">
        <EventMini label="Next CPI" item={summary?.nextCpi} />
        <EventMini label="Next PCE" item={summary?.nextPce} />
        <EventMini label="NFP" item={summary?.nextNfp} />
        <EventMini label="FOMC" item={summary?.nextFomc} />
      </div>
      <div className="wm-cpi-calendar-baseline">
        <span>CONSENSUS</span>
        <strong>{payload?.consensus?.status === 'optional-unavailable' ? 'Optional / paid-grade source not configured' : payload?.consensus?.label || 'Unavailable'}</strong>
        <em>{payload?.baseline?.label || 'No active CPI Polymarket baseline'}</em>
      </div>
      {items.length ? (
        <div className="wm-cpi-calendar-list">
          {items.map((item, index) => (
            <EventRow key={`${item.id || item.kind || 'event'}-${index}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="wm-empty-state">
          <strong>Calendar snapshot warming.</strong>
          <em>Official release sources are configured, but no upcoming CPI/PCE/FOMC/NFP rows are cached yet.</em>
        </div>
      )}
      <div className="wm-cpi-calendar-footer">
        <span>{(payload?.cacheMode || 'snapshot').toUpperCase()}</span>
        <span>{(payload?.sources?.blsCpi || payload?.status || 'warming').toUpperCase()}</span>
        <span>{formatRelative(payload?.generatedAt)}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'cpi-release-calendar': {
    render: (ctx) => {
      const payload = ctx.runtimeData['cpi-release-calendar'] as RuntimeCpiReleaseCalendarPayload | undefined;
      return <CpiReleaseCalendarPanel payload={payload} />;
    },
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'cpi-release-calendar',
  title: 'CPI Release Calendar & Consensus Baseline',
  eyebrow: 'macro',
  description: 'Official CPI, PCE, NFP, and FOMC release timing with Polymarket implied CPI baseline.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeCpiReleaseCalendar(8),
});
