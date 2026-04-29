import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeGeoSanctionsShock } from '@/services/api';
import type { RuntimeGeoSanctionsShockItem, RuntimeGeoSanctionsShockLinkedMarket, RuntimeGeoSanctionsShockPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
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

function feedKindLabel(item: RuntimeGeoSanctionsShockItem) {
  if (item.kind === 'sanction') return 'SANCTION';
  if (item.kind === 'conflict') return 'HOTSPOT';
  if (item.kind === 'notice') return 'NOTICE';
  return 'ALERT';
}

function FeedRow({ item }: { item: RuntimeGeoSanctionsShockItem }) {
  const severity = String(item.severity || 'watch').toLowerCase();
  return (
    <article className={`wm-geo-shock-row sev-${severity}`}>
      <div className="wm-geo-shock-row-top">
        <span className={`wm-geo-shock-kind sev-${severity}`}>{feedKindLabel(item)}</span>
        <span className="wm-geo-shock-source">{item.source || 'Source'}</span>
        <span className="wm-geo-shock-time">{formatRelative(item.occurredAt || null)}</span>
      </div>
      <strong className="wm-geo-shock-headline">{item.headline || 'Untitled shock'}</strong>
      <div className="wm-geo-shock-row-bottom">
        <span className="wm-geo-shock-summary">{item.summary || 'Monitoring developments.'}</span>
        {!!item.targetLabels?.length && (
          <span className="wm-geo-shock-target-mini">{item.targetLabels.slice(0, 2).join(' / ')}</span>
        )}
      </div>
    </article>
  );
}

function LinkedMarketRow({
  item,
  selectedMarketId,
  setSelectedMarketId,
}: {
  item: RuntimeGeoSanctionsShockLinkedMarket;
  selectedMarketId: number | null;
  setSelectedMarketId: (marketId: number) => void;
}) {
  const marketId = Number(item.marketId);
  const canSelect = Number.isFinite(marketId) && marketId > 0;
  const active = canSelect && selectedMarketId === marketId;
  return (
    <button
      type="button"
      className={`wm-geo-shock-market${active ? ' active' : ''}`}
      disabled={!canSelect}
      onClick={() => canSelect && setSelectedMarketId(marketId)}
      title={item.title || 'Linked market'}
    >
      <div className="wm-geo-shock-market-main">
        <strong>{item.title || 'Untitled market'}</strong>
        <span>{String(item.matchedBy || 'watchlist').toUpperCase()}</span>
      </div>
      <div className="wm-geo-shock-market-meta">
        {item.gammaActive ? <em>GAMMA</em> : <em>INDEX</em>}
        <span>{item.score ? `S${item.score}` : '--'}</span>
      </div>
    </button>
  );
}

function GeoShockPanel({ payload, selectedMarketId, setSelectedMarketId }: {
  payload?: RuntimeGeoSanctionsShockPayload | null;
  selectedMarketId: number | null;
  setSelectedMarketId: (marketId: number) => void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const items = payload?.items || [];
  const linkedMarkets = payload?.linkedMarkets || [];
  const summary = payload?.summary;

  return (
    <Panel
      title="GEO / SANCTIONS SHOCK"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain geopolitical shock panel"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={badgeLabel(payload?.status)}
      status="live"
      count={items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Geo / Sanctions Shock</strong>
          <p>Combines OFAC sanctions list updates, Federal Register notices, and an optional conflict feed to surface macro shock signals and map them to live Polymarket markets.</p>
        </div>
      ) : null}
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

        {!!summary?.targetLabels?.length && (
          <div className="wm-geo-shock-target-strip">
            {summary.targetLabels.map((label) => (
              <span className="wm-geo-shock-target-chip" key={label}>{label}</span>
            ))}
          </div>
        )}

        <section className="wm-geo-shock-section">
          <div className="wm-subpanel-title">LATEST SHOCKS</div>
          {items.length ? (
            <div className="wm-geo-shock-feed">
              {items.map((item) => <FeedRow key={item.id || item.headline} item={item} />)}
            </div>
          ) : (
            <div className="wm-empty wm-empty-card">
              <strong>No geopolitical shock items loaded yet.</strong>
              <em>The panel will render OFAC, Federal Register, and conflict rows as soon as the runtime feeds return data.</em>
            </div>
          )}
        </section>

        <section className="wm-geo-shock-section">
          <div className="wm-subpanel-title">TOP LINKED MARKETS</div>
          {linkedMarkets.length ? (
            <div className="wm-geo-shock-markets">
              {linkedMarkets.map((item) => (
                <LinkedMarketRow
                  key={`${item.marketId || item.slug || item.title}`}
                  item={item}
                  selectedMarketId={selectedMarketId}
                  setSelectedMarketId={setSelectedMarketId}
                />
              ))}
            </div>
          ) : (
            <div className="wm-empty wm-empty-card">
              <strong>No linked markets matched yet.</strong>
              <em>The matcher will surface active Polymarket markets when target and theme overlap is detected.</em>
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'geo-sanctions-shock': {
    render: (ctx) => {
      const payload = ctx.runtimeData['geo-sanctions-shock'] as RuntimeGeoSanctionsShockPayload | undefined;
      return (
        <GeoShockPanel
          payload={payload}
          selectedMarketId={ctx.selectedMarketId}
          setSelectedMarketId={ctx.setSelectedMarketId}
        />
      );
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
