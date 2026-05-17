import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeWeatherNews } from '@/services/api';
import type { RuntimeWeatherNewsItem, RuntimeWeatherNewsPayload } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

type SortMode = 'latest' | 'severity' | 'city';

function statusBadge(status?: string | null) {
  const text = String(status || '').toLowerCase();
  if (text === 'ok') return 'LIVE';
  if (text === 'degraded') return 'PARTIAL';
  return text ? text.toUpperCase() : 'SEED';
}

function severityRank(item: RuntimeWeatherNewsItem) {
  const value = String(item.severity || '').toLowerCase();
  if (value === 'warning') return 3;
  if (value === 'watch') return 2;
  return 1;
}

function sortItems(items: RuntimeWeatherNewsItem[], mode: SortMode) {
  const sorted = [...items];
  if (mode === 'city') {
    sorted.sort((a, b) => String(a.city || '').localeCompare(String(b.city || '')) || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    return sorted;
  }
  if (mode === 'severity') {
    sorted.sort((a, b) => severityRank(b) - severityRank(a) || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    return sorted;
  }
  sorted.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return sorted;
}

function nextMode(mode: SortMode): SortMode {
  if (mode === 'latest') return 'severity';
  if (mode === 'severity') return 'city';
  return 'latest';
}

function modeLabel(mode: SortMode) {
  if (mode === 'latest') return 'Latest';
  if (mode === 'severity') return 'Alerts';
  return 'City';
}

function NewsItem({ item }: { item: RuntimeWeatherNewsItem }) {
  const severity = String(item.severity || 'normal').toLowerCase();
  const tags = (item.tags || []).slice(0, 3);
  return (
    <a className={`wm-weather-news-item ${severity}`} href={item.url || '#'} target="_blank" rel="noreferrer">
      <div className="wm-weather-news-card-head">
        <div>
          <span className="wm-weather-news-city">{item.city || 'Global'}</span>
          <span className="wm-weather-news-source">{item.source || 'Weather source'}</span>
        </div>
        <span className="wm-weather-news-severity">{severity === 'warning' ? 'Alert' : severity === 'watch' ? 'Watch' : 'Forecast'}</span>
      </div>
      <strong>{item.title || 'Weather update'}</strong>
      <em>{item.summary || 'Weather summary pending'}</em>
      <div className="wm-weather-news-card-foot">
        <span>{formatRelative(item.publishedAt)}</span>
        {tags.length ? <i>{tags.join(' / ')}</i> : <i>forecast</i>}
        <b>Read source</b>
      </div>
    </a>
  );
}

function WeatherNewsPanel({ payload }: { payload?: RuntimeWeatherNewsPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const items = useMemo(() => sortItems(payload?.items || [], sortMode), [payload?.items, sortMode]);
  const hero = items[0];
  return (
    <Panel
      title="WEATHER NEWS"
      titleControls={(
        <button type="button" className="wm-panel-help-button" aria-label="Explain weather news source" aria-expanded={showHelp} onClick={() => setShowHelp((current) => !current)}>?</button>
      )}
      controls={(
        <button type="button" className="wm-weather-sort-button" aria-label="Change weather news sort" onClick={() => setSortMode((current) => nextMode(current))}>{modeLabel(sortMode)}</button>
      )}
      badge={statusBadge(payload?.status)}
      status={payload?.status === 'ok' ? 'live' : 'muted'}
      count={items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Weather News</strong>
          <p>Seeded Google News RSS results filtered to city weather, forecasts, storms, heat, rain, wind, snow, floods, and alerts. Header sort changes the visible order.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-weather-news-panel"
      dataPanelId="weather-news"
    >
      <div className={`wm-weather-news-hero ${String(hero?.severity || 'normal').toLowerCase()}`}>
        <div>
          <span>Latest</span>
          <strong>{payload?.summary?.warningCount ?? 0} warnings</strong>
        </div>
        <div>
          <span>Cities</span>
          <strong>{payload?.summary?.cityCount ?? 0}</strong>
        </div>
        <div>
          <span>Top city</span>
          <strong>{hero?.city || payload?.summary?.topCity || 'Global'}</strong>
        </div>
      </div>
      <div className="wm-weather-news-list">
        {items.length ? items.map((item) => <NewsItem key={item.id || `${item.city}-${item.title}`} item={item} />) : (
          <div className="wm-registry-empty"><strong>No weather headlines seeded</strong></div>
        )}
      </div>
      <div className="wm-weather-footer">
        <span>{`Updated ${formatRelative(payload?.generatedAt)}`}</span>
        <span>{payload?.cacheMode || 'seed'}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'weather-news': {
    render: (ctx) => <WeatherNewsPanel payload={ctx.runtimeData['weather-news'] as RuntimeWeatherNewsPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'weather-news',
  title: 'Weather News',
  eyebrow: 'weather',
  description: 'City weather headlines from seeded Google News RSS.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeWeatherNews(24),
});
