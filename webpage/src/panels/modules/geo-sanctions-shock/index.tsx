import { Panel } from '@/components/Panel';
import { fetchRuntimeGeoSanctionsShock } from '@/services/api';
import type { RuntimeGeoSanctionsShockPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'LIVE';
  if (normalized === 'empty') return 'QUIET';
  if (normalized === 'degraded') return 'DEGRADED';
  return 'LIVE';
}

function toneLabel(level?: string | null) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'critical') return 'Critical';
  if (normalized === 'elevated') return 'Elevated';
  if (normalized === 'guarded') return 'Guarded';
  return normalized ? normalized[0]?.toUpperCase() + normalized.slice(1) : '--';
}

function upperMetric(value?: string | null) {
  const text = String(value || '').trim();
  return text ? text.toUpperCase() : '--';
}

function GeoShockPanel({ payload }: {
  payload?: RuntimeGeoSanctionsShockPayload | null;
}) {
  const summary = payload?.summary;

  return (
    <Panel
      title="GEO / SANCTIONS SHOCK"
      badge={badgeLabel(payload?.status)}
      status="live"
      className="wm-market-panel wm-geo-shock-panel"
    >
      <div className="wm-geo-shock-layout">
        <section className="wm-geo-shock-summary-grid">
          <article className="wm-geo-shock-metric">
            <span>HOTSPOTS</span>
            <strong>{summary?.hotspotCount ?? 0}</strong>
          </article>
          <article className="wm-geo-shock-metric">
            <span>NEW SANCTIONS</span>
            <strong>{summary?.newSanctionsCount ?? 0}</strong>
          </article>
          <article className="wm-geo-shock-metric wide">
            <span>TARGETS</span>
            <strong>{upperMetric(summary?.targetSummary || 'MONITORING')}</strong>
          </article>
          <article className="wm-geo-shock-metric tone-critical">
            <span>NUCLEAR RISK</span>
            <strong>{upperMetric(toneLabel(summary?.nuclearRisk))}</strong>
          </article>
          <article className="wm-geo-shock-metric tone-warning">
            <span>MILITARY FEED</span>
            <strong>{upperMetric(summary?.militaryFeed || 'standby')}</strong>
          </article>
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
