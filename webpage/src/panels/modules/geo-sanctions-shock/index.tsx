import { Panel } from '@/components/Panel';
import { fetchRuntimeGeoSanctionsShock } from '@/services/api';
import type { RuntimeGeoSanctionsShockPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { PanelGlyph, signalToneClass } from '../macro-intel';

function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'LIVE';
  if (normalized === 'empty') return 'QUIET';
  if (normalized === 'degraded') return 'DEGRADED';
  return 'LIVE';
}

function panelTone(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

function upperMetric(value?: string | null) {
  const text = String(value || '').trim();
  return text ? text.toUpperCase() : '--';
}

function severityClass(level?: string | null) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'critical') return 'sev-critical';
  if (normalized === 'warning') return 'sev-warning';
  return 'sev-watch';
}

function severityLabel(level?: string | null) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'critical') return 'CRITICAL';
  if (normalized === 'warning') return 'ALERT';
  return 'WATCH';
}

function kindLabel(kind?: string | null) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'sanction') return 'SANCTION';
  if (normalized === 'notice') return 'NOTICE';
  if (normalized === 'conflict') return 'CONFLICT';
  return 'SIGNAL';
}

function kindGlyph(kind?: string | null) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'sanction') return 'S';
  if (normalized === 'notice') return 'N';
  if (normalized === 'conflict') return '!';
  return 'G';
}

function formatAge(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '--';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
  const diffMs = Date.now() - parsed.getTime();
  const absDiff = Math.abs(diffMs);
  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(absDiff / 3600000);
  const days = Math.floor(absDiff / 86400000);
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return `${minutes}M AGO`;
  if (hours < 24) return `${hours}H AGO`;
  if (days < 30) return `${days}D AGO`;
  return parsed.toISOString().slice(0, 10);
}

function geoSignalLabel(payload?: RuntimeGeoSanctionsShockPayload | null) {
  const summary = payload?.summary;
  const nuclear = String(summary?.nuclearRisk || '').toLowerCase();
  if (nuclear === 'critical' || nuclear === 'elevated') return `NUCLEAR RISK ${upperMetric(nuclear)}`;
  if ((summary?.newSanctionsCount ?? 0) > 0) return 'SANCTIONS ACTIVE';
  if ((summary?.hotspotCount ?? 0) > 0) return 'HOTSPOTS WATCH';
  return 'GEO QUIET';
}

function geoSignalTone(payload?: RuntimeGeoSanctionsShockPayload | null) {
  const signal = geoSignalLabel(payload);
  if (/CRITICAL|ELEVATED|ACTIVE/.test(signal)) return signalToneClass('alert high');
  if (/WATCH/.test(signal)) return signalToneClass('watch');
  return signalToneClass('quiet');
}

function GeoShockPanel({ payload }: {
  payload?: RuntimeGeoSanctionsShockPayload | null;
}) {
  const summary = payload?.summary;
  const items = payload?.items || [];
  const signal = geoSignalLabel(payload);

  return (
    <Panel
      title="GEO / SANCTIONS SHOCK"
      badge={badgeLabel(payload?.status)}
      status={panelTone(payload?.status)}
      count={items.length || undefined}
      className="wm-market-panel wm-geo-shock-panel"
      dataPanelId="geo-sanctions-shock"
    >
      <div className="wm-geo-shock-layout">
        <div className={`wm-intel-signal-band ${geoSignalTone(payload)}`}>
          <div className="wm-intel-signal-main">
            <PanelGlyph icon="geo" tone={geoSignalTone(payload)} />
            <div className="wm-intel-signal-copy">
              <span>World shock driver</span>
              <strong>{signal}</strong>
            </div>
          </div>
          <em>{`${summary?.newSanctionsCount ?? 0} sanctions / ${summary?.hotspotCount ?? 0} hotspots`}</em>
        </div>

        <section className="wm-geo-shock-section compact">
          <header className="wm-geo-shock-section-header">
            <span>LATEST SHOCKS</span>
          </header>
          <div className="wm-geo-shock-feed">
            {items.length ? items.slice(0, 3).map((item) => {
              const sevClass = severityClass(item.severity);
              const targetLabel = upperMetric(item.targetLabels?.[0] || item.country || '');
              return (
                <article key={item.id || `${item.headline}-${item.occurredAt}`} className={`wm-geo-shock-row ${sevClass}`}>
                  <span className={`wm-row-glyph ${sevClass}`}>{kindGlyph(item.kind)}</span>
                  <div className="wm-geo-shock-row-main">
                    <div className="wm-geo-shock-row-top">
                      <span className={`wm-geo-shock-kind ${sevClass}`}>{severityLabel(item.severity)}</span>
                      <span className="wm-geo-shock-source">{kindLabel(item.kind)} / {upperMetric(item.source || 'SOURCE')}</span>
                      <span className="wm-geo-shock-time">{formatAge(item.occurredAt)}</span>
                    </div>
                    <div className="wm-geo-shock-headline">{item.headline || 'Monitoring update'}</div>
                    {targetLabel && targetLabel !== '--' ? <span className="wm-geo-shock-target-mini">{targetLabel}</span> : null}
                  </div>
                </article>
              );
            }) : (
              <div className="wm-geo-shock-empty">No seeded shock items yet.</div>
            )}
          </div>
        </section>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'geo-sanctions-shock': {
    render: (ctx) => {
      const payload = ctx.runtimeData['geo-sanctions-shock'] as RuntimeGeoSanctionsShockPayload | undefined;
      return <GeoShockPanel payload={payload} />;
    },
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'geo-sanctions-shock',
  title: 'Geopolitical & Sanctions Shock',
  eyebrow: 'world',
  description: 'Geopolitical shocks, sanctions changes, and linked macro-risk markets.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeGeoSanctionsShock(6),
});
