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

function panelTone(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
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

function sourceHealthLabel(sources?: Record<string, string>) {
  if (!sources) return 'SOURCES WARMING';
  const values = Object.values(sources);
  if (values.length === 0) return 'SOURCES WARMING';
  const okCount = values.filter((value) => String(value || '').toLowerCase() === 'ok').length;
  return `${okCount}/${values.length} SOURCES OK`;
}

function conflictFeedLabel(payload?: RuntimeGeoSanctionsShockPayload | null) {
  const provider = upperMetric(payload?.conflictProvider || 'conflict');
  const state = upperMetric(payload?.conflictState || payload?.sources?.conflictFeed || 'warming');
  return `${provider} ${state}`;
}

function GeoShockPanel({ payload }: {
  payload?: RuntimeGeoSanctionsShockPayload | null;
}) {
  const summary = payload?.summary;
  const items = payload?.items || [];
  const targetBreakdown = payload?.targetBreakdown || [];

  return (
    <Panel
      title="GEO / SANCTIONS SHOCK"
      badge={badgeLabel(payload?.status)}
      status={panelTone(payload?.status)}
      count={items.length || undefined}
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

        <section className="wm-geo-shock-section">
          <header className="wm-geo-shock-section-header">
            <span>LATEST SHOCKS</span>
          </header>
          <div className="wm-geo-shock-feed">
            {items.length ? items.slice(0, 5).map((item) => {
              const sevClass = severityClass(item.severity);
              const targetLabel = upperMetric(item.targetLabels?.[0] || item.country || '');
              return (
                <article key={item.id || `${item.headline}-${item.occurredAt}`} className={`wm-geo-shock-row ${sevClass}`}>
                  <div className="wm-geo-shock-row-top">
                    <span className={`wm-geo-shock-kind ${sevClass}`}>{severityLabel(item.severity)}</span>
                    <span className="wm-geo-shock-source">{kindLabel(item.kind)} / {upperMetric(item.source || 'SOURCE')}</span>
                    <span className="wm-geo-shock-time">{formatAge(item.occurredAt)}</span>
                  </div>
                  <div className="wm-geo-shock-headline">{item.headline || 'Monitoring update'}</div>
                  <div className="wm-geo-shock-row-bottom">
                    <span className="wm-geo-shock-summary">{item.summary || 'No detail yet.'}</span>
                    {targetLabel && targetLabel !== '--' ? (
                      <span className="wm-geo-shock-target-mini">{targetLabel}</span>
                    ) : null}
                  </div>
                </article>
              );
            }) : (
              <div className="wm-geo-shock-empty">No seeded shock items yet.</div>
            )}
          </div>
        </section>

        <section className="wm-geo-shock-section">
          <header className="wm-geo-shock-section-header">
            <span>TARGET BREAKDOWN</span>
          </header>
          <div className="wm-geo-shock-breakdown">
            {targetBreakdown.length ? targetBreakdown.map((target) => (
              <article key={target.label || 'target'} className="wm-geo-shock-breakdown-row">
                <div className="wm-geo-shock-breakdown-main">
                  <div className="wm-geo-shock-breakdown-top">
                    <strong>{upperMetric(target.label || 'MONITORING')}</strong>
                    <span>{target.count ?? 0}</span>
                  </div>
                  <div className="wm-geo-shock-breakdown-meta">
                    <span>{target.latestHeadline || 'No recent linked event.'}</span>
                    <em>
                      {upperMetric(target.latestSource || 'SOURCE')}
                      {target.latestOccurredAt ? ` / ${formatAge(target.latestOccurredAt)}` : ''}
                    </em>
                  </div>
                </div>
              </article>
            )) : (
              <div className="wm-geo-shock-empty">No target concentration yet.</div>
            )}
          </div>
        </section>

        <footer className="wm-geo-shock-footer">
          <span>{sourceHealthLabel(payload?.sources)}</span>
          <span>{conflictFeedLabel(payload)}</span>
          <span>{upperMetric(payload?.cacheMode || 'warming')}</span>
          <span>{formatAge(payload?.generatedAt)}</span>
        </footer>
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
