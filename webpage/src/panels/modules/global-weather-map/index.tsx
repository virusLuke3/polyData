import { useMemo, useState } from 'preact/hooks';
import { geoEquirectangular, geoGraticule, geoPath, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-110m.json';
import { Panel } from '@/components/Panel';
import { fetchRuntimeGlobalWeatherMap } from '@/services/api';
import type { RuntimeGlobalWeatherCity, RuntimeGlobalWeatherMapPayload, RuntimeWeatherQuoteBin } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

const MAP_W = 720;
const MAP_H = 310;

function statusBadge(status?: string | null) {
  const text = String(status || '').toLowerCase();
  if (text === 'ok') return 'LIVE';
  if (text === 'degraded') return 'PARTIAL';
  if (text === 'warming') return 'WARMING';
  return text ? text.toUpperCase() : 'SEED';
}

function panelStatus(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

function tempLabel(value?: string | number | null, unit?: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n)}°${unit || ''}`;
}

function probLabel(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n * 100)}%`;
}

function cityTone(city?: RuntimeGlobalWeatherCity | null) {
  const temp = Number(city?.forecastHigh ?? city?.currentTemp);
  if (Number.isFinite(temp)) {
    if (String(city?.unit || '').toUpperCase() === 'F') {
      if (temp >= 90) return 'hot';
      if (temp <= 45) return 'cool';
    } else {
      if (temp >= 32) return 'hot';
      if (temp <= 7) return 'cool';
    }
  }
  if (city?.eventSlug) return 'market';
  return 'neutral';
}

function quoteTone(city?: RuntimeGlobalWeatherCity | null) {
  if (!city?.eventSlug) return 'neutral';
  const [quoted, total] = String(city.quoteCoverage || '').split('/').map((part) => Number(part));
  const quotedCount = Number.isFinite(quoted) ? Number(quoted) : 0;
  const totalCount = Number.isFinite(total) ? Number(total) : 0;
  if (totalCount > 0 && quotedCount / totalCount >= 0.7) return 'market';
  return 'watch';
}

function sourceTone(value?: string | null) {
  const text = String(value || '').toLowerCase();
  if (text === 'ok') return 'ok';
  if (text === 'empty') return 'neutral';
  return 'bad';
}

function Sparkline({ bins }: { bins?: RuntimeWeatherQuoteBin[] }) {
  const points = (bins || []).filter((bin) => Number.isFinite(Number(bin.midPriceYes))).slice(0, 14);
  if (points.length < 2) return <span className="wm-weather-spark-empty">NO CURVE</span>;
  const d = points.map((bin, index) => {
    const x = (index / Math.max(1, points.length - 1)) * 100;
    const y = 28 - (Number(bin.midPriceYes) * 26);
    return `${x.toFixed(1)},${Math.max(2, Math.min(28, y)).toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="wm-weather-spark" viewBox="0 0 100 30" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function buildProjection() {
  const projection = geoEquirectangular();
  const world = feature(countriesAtlas as any, (countriesAtlas as any).objects.countries) as any;
  projection.fitExtent([[14, 12], [MAP_W - 14, MAP_H - 10]], world);
  return { projection, world };
}

function projectCity(projection: GeoProjection, city: RuntimeGlobalWeatherCity) {
  const lat = Number(city.lat);
  const lon = Number(city.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const projected = projection([lon, lat]);
  return projected ? { x: projected[0], y: projected[1] } : null;
}

function WeatherMapCanvas({ items, selectedCityId, onSelectCity }: { items: RuntimeGlobalWeatherCity[]; selectedCityId?: string | null; onSelectCity: (cityId: string) => void }) {
  const { projection, world } = useMemo(buildProjection, []);
  const graticule = useMemo(() => geoGraticule().step([30, 30])(), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  return (
    <div className="wm-weather-map-canvas">
      <svg className="wm-weather-map-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect x="0" y="0" width={MAP_W} height={MAP_H} />
        <path className="wm-weather-map-grid" d={path(graticule) || ''} />
        <path className="wm-weather-map-land" d={path(world) || ''} />
      </svg>
      {items.map((city) => {
        const projected = projectCity(projection, city);
        if (!projected || !city.cityId) return null;
        const tone = cityTone(city);
        const selected = city.cityId === selectedCityId;
        return (
          <button
            key={city.cityId}
            type="button"
            className={`wm-weather-marker ${tone}${selected ? ' selected' : ''}`}
            style={{ left: `${(projected.x / MAP_W) * 100}%`, top: `${(projected.y / MAP_H) * 100}%` }}
            onClick={() => onSelectCity(String(city.cityId))}
            title={`${city.city || 'City'} ${tempLabel(city.currentTemp, city.unit)} ${city.topBin?.label || ''}`}
          >
            <span />
            <strong>{city.city}</strong>
            <em>{city.topBin?.label || tempLabel(city.forecastHigh ?? city.currentTemp, city.unit)}</em>
          </button>
        );
      })}
    </div>
  );
}

function WeatherSummary({ payload, items }: { payload?: RuntimeGlobalWeatherMapPayload | null; items: RuntimeGlobalWeatherCity[] }) {
  const hottest = payload?.summary?.hottestCity;
  return (
    <div className="wm-weather-summary">
      <div>
        <span>Mapped Cities</span>
        <strong>{payload?.summary?.mappedCount ?? items.length}/{payload?.summary?.cityCount ?? items.length}</strong>
      </div>
      <div>
        <span>PMKT Events</span>
        <strong>{payload?.summary?.liveMarketCount ?? 0}</strong>
      </div>
      <div>
        <span>Hotspot</span>
        <strong>{hottest?.city || '--'} {hottest ? tempLabel(hottest.forecastHigh ?? hottest.currentTemp, hottest.unit) : ''}</strong>
      </div>
    </div>
  );
}

function CityDetail({ city }: { city?: RuntimeGlobalWeatherCity | null }) {
  if (!city) return <div className="wm-registry-empty"><strong>Weather seed warming</strong></div>;
  const states = city.sourceStates || {};
  return (
    <div className={`wm-weather-detail ${cityTone(city)}`}>
      <div className="wm-weather-detail-main">
        <span className="wm-weather-glyph">WX</span>
        <div>
          <span>{city.region || city.country || 'Weather city'}</span>
          <strong>{city.city} {tempLabel(city.currentTemp, city.unit)}</strong>
          <em>{city.condition || 'Condition pending'} · high {tempLabel(city.todayHigh, city.unit)} · METAR {tempLabel(city.metarTemp, city.unit)}</em>
        </div>
      </div>
      <div className="wm-weather-quote">
        <Sparkline bins={city.bins} />
        <div>
          <span>PMKT top bin</span>
          <strong>{city.topBin?.label || 'No event'}</strong>
          <em>{probLabel(city.topBin?.midPriceYes)} · {city.quoteCoverage || '0/0'}</em>
        </div>
      </div>
      <div className="wm-weather-source-row">
        <span className={`wm-weather-source ${sourceTone(states.openMeteo)}`}>OPEN {String(states.openMeteo || 'unknown').toUpperCase()}</span>
        <span className={`wm-weather-source ${sourceTone(states.metar)}`}>METAR {String(states.metar || 'unknown').toUpperCase()}</span>
        <span className={`wm-weather-source ${sourceTone(states.polymarket)}`}>PMKT {String(states.polymarket || 'unknown').toUpperCase()}</span>
        {city.marketUrl ? <a href={city.marketUrl} target="_blank" rel="noreferrer">OPEN PMKT</a> : null}
      </div>
    </div>
  );
}

function RankedRows({ items }: { items: RuntimeGlobalWeatherCity[] }) {
  const hot = [...items].sort((a, b) => Number(b.forecastHigh ?? b.currentTemp ?? -999) - Number(a.forecastHigh ?? a.currentTemp ?? -999)).slice(0, 3);
  const stale = items.filter((item) => Object.values(item.sourceStates || {}).includes('error')).slice(0, 2);
  const rows = [...hot, ...stale.filter((row) => !hot.some((hotRow) => hotRow.cityId === row.cityId))].slice(0, 5);
  return (
    <div className="wm-weather-ranked">
      {rows.map((city) => (
        <div key={`rank-${city.cityId}`} className={cityTone(city)}>
          <span className="wm-weather-row-glyph">{city.eventSlug ? 'PM' : 'WX'}</span>
          <strong>{city.city}</strong>
          <em>{city.condition || city.region || '--'}</em>
          <b>{tempLabel(city.forecastHigh ?? city.currentTemp, city.unit)}</b>
          <i className={`wm-weather-source ${quoteTone(city)}`}>{city.quoteCoverage || 'NO PMKT'}</i>
        </div>
      ))}
    </div>
  );
}

function GlobalWeatherMapPanel({ payload }: { payload?: RuntimeGlobalWeatherMapPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const items = payload?.items || [];
  const [selectedCityId, setSelectedCityId] = useState<string | null>(items[0]?.cityId ? String(items[0].cityId) : null);
  const selected = items.find((item) => item.cityId === selectedCityId) || items[0];
  return (
    <Panel
      title="GLOBAL WEATHER MAP"
      titleControls={(
        <button type="button" className="wm-panel-help-button" aria-label="Explain global weather map" aria-expanded={showHelp} onClick={() => setShowHelp((current) => !current)}>?</button>
      )}
      badge={statusBadge(payload?.status)}
      status={panelStatus(payload?.status)}
      count={`${payload?.summary?.mappedCount ?? items.length}/${payload?.summary?.cityCount ?? items.length}`}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Global Weather Map</strong>
          <p>Combines seeded Open-Meteo forecasts, METAR observations, and Polymarket temperature events. Marker color tracks hot/cool weather and purple marks active PMKT quote coverage.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-global-weather-map-panel"
      dataPanelId="global-weather-map"
    >
      <WeatherSummary payload={payload} items={items} />
      <WeatherMapCanvas items={items} selectedCityId={selected?.cityId || null} onSelectCity={setSelectedCityId} />
      <CityDetail city={selected} />
      <RankedRows items={items} />
      <div className="wm-weather-footer">
        <span>{`Updated ${formatRelative(payload?.generatedAt)}`}</span>
        <span>{payload?.cacheMode || 'seed'}</span>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'global-weather-map': {
    render: (ctx) => <GlobalWeatherMapPanel payload={ctx.runtimeData['global-weather-map'] as RuntimeGlobalWeatherMapPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'global-weather-map',
  title: 'Global Weather Map',
  eyebrow: 'weather',
  description: 'Global city weather, METAR freshness, and Polymarket temperature quote coverage.',
  defaultEnabled: false,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeGlobalWeatherMap(34),
});
