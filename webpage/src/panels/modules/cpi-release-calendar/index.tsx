import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeCpiReleaseCalendar } from '@/services/api';
import type { RuntimeCpiCalendarItem, RuntimeCpiReleaseCalendarPayload, RuntimePolymarketMacroMapPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { LinkedMarketRegistry, MarketImplicationStrip, PanelGlyph, RowGlyph, StatusBadge, linkedMacroMarkets, signalToneClass } from '../macro-intel';
import type { PanelGlyphName } from '../macro-intel';

function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return undefined;
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

function eventIcon(kind?: string | null): PanelGlyphName {
  const value = String(kind || '').toLowerCase();
  if (value === 'cpi' || value === 'pce') return 'cpi';
  if (value === 'fomc') return 'fed';
  if (value === 'nfp') return 'labor';
  return 'calendar';
}

function dateShortLabel(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'America/New_York',
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
      <strong>{item ? dateShortLabel(item.releaseAt) : '--'}</strong>
      <em>{item?.referencePeriod || item?.title || 'No upcoming release'}</em>
    </div>
  );
}

function EventRow({ item }: { item: RuntimeCpiCalendarItem }) {
  const kind = String(item.kind || '').toLowerCase();
  return (
    <div className={`wm-cpi-calendar-row ${kind}`}>
      <RowGlyph icon={eventIcon(item.kind)} tone={kind === 'fomc' ? 'watch' : kind === 'cpi' ? 'cool' : 'neutral'} label={eventKindLabel(item.kind)} />
      <div className="wm-cpi-calendar-row-time">
        <StatusBadge tone={kind === 'cpi' ? 'official' : 'neutral'}>{eventKindLabel(item.kind)}</StatusBadge>
        <strong>{dateShortLabel(item.releaseAt)}</strong>
      </div>
      <div className="wm-cpi-calendar-row-main">
        <strong>{item.title || 'Macro release'}</strong>
        <div>
          <span>{item.referencePeriod || 'Reference period pending'}</span>
          <span>/</span>
          <span>{item.marketRelevance || 'Macro market relevance'}</span>
        </div>
      </div>
      <StatusBadge tone={kind === 'fomc' ? 'watch' : 'official'}>{formatRelative(item.releaseAt)}</StatusBadge>
    </div>
  );
}

function CpiReleaseCalendarPanel({ payload, macroPayload }: { payload?: RuntimeCpiReleaseCalendarPayload | null; macroPayload?: RuntimePolymarketMacroMapPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const summary = payload?.summary;
  const items = payload?.items || [];
  const linkedMarkets = linkedMacroMarkets(macroPayload, ['cpi', 'fed']);
  const riskTone = signalToneClass(summary?.signal || summary?.risk);
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
      <div className={`wm-intel-signal-band ${riskTone}`}>
        <div className="wm-intel-signal-main">
          <PanelGlyph icon="calendar" tone={riskTone} />
          <div className="wm-intel-signal-copy">
            <span>Event Risk</span>
            <strong>{summary?.signal || 'CALENDAR WARMING'}</strong>
          </div>
        </div>
        <em>Release timing / baseline probability</em>
      </div>
      <div className={`wm-cpi-calendar-hero compact ${summary?.risk || 'unknown'}`}>
        <div>
          <span>Time To Event</span>
          <strong>{compactHours(summary?.hoursToEvent)}</strong>
        </div>
        <div>
          <span>PMKT Baseline</span>
          <strong>{probabilityLabel(summary?.baselineProbability)}</strong>
        </div>
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
          <em>No upcoming CPI/PCE/FOMC/NFP rows are cached yet.</em>
        </div>
      )}
      <MarketImplicationStrip items={['CPI bucket', 'PCE/Core PCE', 'Fed decision', `${probabilityLabel(summary?.baselineProbability)} PMKT baseline`]} />
      <div className="wm-cpi-calendar-mini-grid">
        <EventMini label="Next CPI" item={summary?.nextCpi} />
        <EventMini label="Next PCE" item={summary?.nextPce} />
        <EventMini label="NFP" item={summary?.nextNfp} />
        <EventMini label="FOMC" item={summary?.nextFomc} />
      </div>
      <div className="wm-cpi-calendar-baseline">
        <span>CONSENSUS</span>
        <strong>{payload?.consensus?.status === 'optional-unavailable' ? 'Consensus unavailable' : payload?.consensus?.label || 'Unavailable'}</strong>
        <em>{payload?.baseline?.label || 'No active CPI Polymarket baseline'}</em>
      </div>
      <LinkedMarketRegistry title="PMKT release markets" items={linkedMarkets} emptyLabel="Awaiting macro map" />
      <div className="wm-cpi-calendar-footer">
        <span>{`Updated ${formatRelative(payload?.generatedAt)}`}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'cpi-release-calendar': {
    render: (ctx) => {
      const payload = ctx.runtimeData['cpi-release-calendar'] as RuntimeCpiReleaseCalendarPayload | undefined;
      const macroPayload = ctx.runtimeData['polymarket-macro-map'] as RuntimePolymarketMacroMapPayload | undefined;
      return <CpiReleaseCalendarPanel payload={payload} macroPayload={macroPayload} />;
    },
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'cpi-release-calendar',
  title: 'CPI Release Calendar & Consensus Baseline',
  eyebrow: 'macro',
  description: 'Official CPI, PCE, NFP, and FOMC release timing with Polymarket implied CPI baseline.',
  defaultEnabled: false,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeCpiReleaseCalendar(8),
});
