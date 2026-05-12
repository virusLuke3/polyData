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

function NewsItem({ item }: { item: RuntimeWeatherNewsItem }) {
  const severity = String(item.severity || 'normal').toLowerCase();
  return (
    <a className={`wm-weather-news-item ${severity}`} href={item.url || '#'} target="_blank" rel="noreferrer">
      <span className="wm-weather-news-glyph">{severity === 'warning' ? 'AL' : severity === 'watch' ? 'WX' : 'FC'}</span>
      <div>
        <span>{item.city || 'Global'} · {item.source || 'News'}</span>
        <strong>{item.title || 'Weather update'}</strong>
        <em>{item.summary || 'Weather summary pending'}</em>
        <i>{(item.tags || []).slice(0, 3).join(' / ') || 'forecast'}</i>
      </div>
      <b>{formatRelative(item.publishedAt)}</b>
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
        <button type="button" className="wm-weather-sort-button" aria-label="Change weather news sort" onClick={() => setSortMode((current) => nextMode(current))}>{sortMode}</button>
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
        <span className="wm-weather-news-glyph">{hero?.severity === 'warning' ? 'AL' : 'WX'}</span>
        <div>
          <span>{payload?.summary?.warningCount ?? 0} warnings · {payload?.summary?.cityCount ?? 0} cities</span>
          <strong>{hero?.title || 'Weather news seed warming'}</strong>
          <em>{hero?.city || payload?.summary?.topCity || 'Global'} · {formatRelative(hero?.publishedAt || payload?.generatedAt)}</em>
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
  defaultEnabled: false,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeWeatherNews(24),
});

