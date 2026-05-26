import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { getWeatherMapFallbackStyle, getWeatherMapStyle } from '@/config/weatherBasemap';
import type { WorldCupCityWeather, WorldCupMatch, WorldCupVenueCity } from './types';

type WorldCupMapProps = {
  cities: WorldCupVenueCity[];
  matches: WorldCupMatch[];
  weather: WorldCupCityWeather[];
  nextMatch: WorldCupMatch | null;
  selectedCityId: string | null;
  selectedMatchId: string | null;
  onSelectCity: (cityId: string) => void;
};

type WorldCupMapPoint = {
  city: WorldCupVenueCity;
  weather: WorldCupCityWeather | null;
  count: number;
  status: string;
  x: number;
  y: number;
  visible: boolean;
};

const IMPORTANT_CITY_IDS = new Set(['mexico-city', 'new-york-new-jersey', 'dallas', 'los-angeles']);

function cityStatus(cityId: string, matches: WorldCupMatch[]) {
  const cityMatches = matches.filter((match) => match.cityId === cityId);
  if (cityMatches.some((match) => match.status === 'live')) return 'live';
  if (cityMatches.some((match) => match.status === 'scheduled')) return 'scheduled';
  return 'finished';
}

function statusLabel(status: string) {
  if (status === 'live') return 'LIVE';
  if (status === 'scheduled') return 'UPCOMING';
  return 'FINISHED';
}

function compactCityName(city: string) {
  return city.replace(' / ', '/').replace(' Bay Area', '').replace(' Gardens', '');
}

function matchTitle(match: WorldCupMatch) {
  return `${match.homeTeam} vs ${match.awayTeam}`;
}

function shortKickoff(match: WorldCupMatch) {
  return match.kickoffLocal.replace(',', ' ·');
}

function projectPoints(
  map: MapLibreMap | null,
  cities: WorldCupVenueCity[],
  matches: WorldCupMatch[],
  weatherByCity: Map<string, WorldCupCityWeather>,
): WorldCupMapPoint[] {
  if (!map) return [];
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  return cities.map((city) => {
    const projected = map.project([city.longitude, city.latitude]);
    const count = matches.filter((match) => match.cityId === city.id).length;
    return {
      city,
      weather: weatherByCity.get(city.id) || null,
      count,
      status: cityStatus(city.id, matches),
      x: projected.x,
      y: projected.y,
      visible: projected.x > -120 && projected.x < width + 120 && projected.y > -90 && projected.y < height + 90,
    };
  });
}

function LayerPanel() {
  const layers = [
    ['✓', '🏟', 'Host cities', 'ACTIVE'],
    ['✓', '⚽', 'Match schedule', 'LIVE'],
    ['✓', '☁', 'Weather watch', 'FORECAST'],
    ['✓', '◎', 'Polymarket markets', 'LOCAL DB'],
    ['✓', '$', 'Sportsbook odds', 'WATCH'],
    ['', '📰', 'News intel', 'FEED'],
    ['', '☷', 'Squad lists', 'PENDING'],
  ];
  return (
    <aside className="wm-worldcup-map-layer-panel">
      <div className="wm-worldcup-map-layer-head">
        <strong>LAYERS</strong>
        <button type="button" aria-label="Layer help">?</button>
        <span>▼</span>
      </div>
      <input aria-label="Search layers" placeholder="Search layers..." />
      <div className="wm-worldcup-map-layer-list">
        {layers.map(([checked, icon, label, status]) => (
          <label className={`wm-worldcup-map-layer-row ${checked ? 'active' : ''}`} key={label}>
            <i>{checked}</i>
            <b>{icon}</b>
            <span>{label}</span>
            <em>{status}</em>
          </label>
        ))}
      </div>
      <footer>World Cup Atlas · Seed-first</footer>
    </aside>
  );
}

function MapControls({ map }: { map: MapLibreMap | null }) {
  return (
    <div className="wm-worldcup-map-controls">
      <button type="button" onClick={() => map?.zoomIn()} aria-label="Zoom in">+</button>
      <button type="button" onClick={() => map?.zoomOut()} aria-label="Zoom out">−</button>
      <button type="button" onClick={() => map?.easeTo({ center: [-96, 39], zoom: 2.65, pitch: 0, bearing: 0 })} aria-label="Reset view">⌂</button>
    </div>
  );
}

export function WorldCupMap({ cities, matches, weather, nextMatch, selectedCityId, selectedMatchId, onSelectCity }: WorldCupMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const citiesRef = useRef(cities);
  const matchesRef = useRef(matches);
  const weatherByCityRef = useRef(new Map<string, WorldCupCityWeather>());
  const fallbackAppliedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapDegraded, setMapDegraded] = useState(false);
  const [screenPoints, setScreenPoints] = useState<WorldCupMapPoint[]>([]);

  const weatherByCity = useMemo(() => {
    const index = new Map<string, WorldCupCityWeather>();
    weather.forEach((item) => index.set(item.cityId, item));
    return index;
  }, [weather]);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;
  const nextCityId = nextMatch?.cityId || null;
  const activePoint = screenPoints.find((point) => point.city.id === selectedCityId)
    || screenPoints.find((point) => point.city.id === selectedMatch?.cityId)
    || screenPoints.find((point) => point.city.id === nextCityId)
    || null;
  const activeMatches = activePoint ? matches.filter((match) => match.cityId === activePoint.city.id) : [];
  const nextCityMatch = activePoint ? activeMatches.find((match) => match.id === nextMatch?.id) || activeMatches.find((match) => match.status === 'scheduled') : null;

  useEffect(() => {
    citiesRef.current = cities;
    matchesRef.current = matches;
    weatherByCityRef.current = weatherByCity;
  }, [cities, matches, weatherByCity]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host || mapRef.current) return undefined;
    const map = new maplibregl.Map({
      container: host,
      style: getWeatherMapStyle('dark-matter'),
      center: [-96, 39],
      zoom: 2.65,
      minZoom: 1.85,
      maxZoom: 7,
      maxBounds: [[-178, -18], [-18, 82]],
      renderWorldCopies: false,
      attributionControl: false,
      interactive: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      canvasContextAttributes: { powerPreference: 'high-performance' },
    });
    mapRef.current = map;

    const syncPoints = () => {
      setScreenPoints(projectPoints(map, citiesRef.current, matchesRef.current, weatherByCityRef.current));
    };
    const resizeAndSync = () => {
      map.resize();
      map.triggerRepaint();
      syncPoints();
    };

    map.on('load', () => {
      setMapReady(true);
      resizeAndSync();
    });
    map.on('idle', () => {
      setMapReady(true);
      resizeAndSync();
    });
    map.on('move', syncPoints);
    map.on('zoom', syncPoints);
    map.on('resize', syncPoints);
    map.on('styledata', resizeAndSync);

    let tileErrorCount = 0;
    const onError = (event: { error?: Error; message?: string }) => {
      const message = event.error?.message || event.message || '';
      if (!message || fallbackAppliedRef.current) return;
      if (/Failed to fetch|AJAXError|CORS|NetworkError|403|Forbidden/i.test(message)) {
        tileErrorCount += 1;
        if (tileErrorCount >= 2) {
          fallbackAppliedRef.current = true;
          setMapDegraded(true);
          map.setStyle(getWeatherMapFallbackStyle('dark'), { diff: false });
          window.requestAnimationFrame(resizeAndSync);
        }
      }
    };
    map.on('error', onError);

    const initialFrame = window.requestAnimationFrame(resizeAndSync);
    const settleTimer = window.setTimeout(resizeAndSync, 300);
    const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(resizeAndSync));
    if (rootRef.current) resizeObserver.observe(rootRef.current);

    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.clearTimeout(settleTimer);
      resizeObserver.disconnect();
      map.off('error', onError);
      map.off('move', syncPoints);
      map.off('zoom', syncPoints);
      map.off('resize', syncPoints);
      map.off('styledata', resizeAndSync);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    setScreenPoints(projectPoints(mapRef.current, cities, matches, weatherByCity));
  }, [cities, matches, selectedCityId, weatherByCity]);

  return (
    <div ref={rootRef} className={`wm-worldcup-map wm-worldcup-maplibre ${mapReady ? 'ready' : ''} ${mapDegraded ? 'degraded' : ''}`}>
      <div ref={mapHostRef} className="wm-worldcup-maplibre-host" />
      <LayerPanel />
      <div className="wm-worldcup-map-point-layer">
        {screenPoints.filter((point) => point.visible).map((point) => {
          const selected = point.city.id === selectedCityId || point.city.id === selectedMatch?.cityId;
          const next = point.city.id === nextCityId;
          const important = IMPORTANT_CITY_IDS.has(point.city.id) || selected || next;
          return (
            <button
              type="button"
              key={point.city.id}
              className={`wm-worldcup-map-point ${point.status} ${selected ? 'selected' : ''} ${next ? 'next' : ''} ${important ? 'important' : ''}`}
              style={{ transform: `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)` }}
              title={`${point.city.city} · ${point.count} matches`}
              onClick={() => {
                onSelectCity(point.city.id);
                mapRef.current?.easeTo({ center: [point.city.longitude, point.city.latitude], zoom: Math.max(mapRef.current.getZoom(), 3.25), duration: 550 });
              }}
            >
              <span className="halo" />
              <span className="dot" />
              {important ? (
                <span className="label">
                  <strong>{compactCityName(point.city.city)}</strong>
                  <em>{statusLabel(point.status)} · {point.count}</em>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {activePoint ? (
        <aside className="wm-worldcup-map-inspector">
          <span>SELECTED HOST CITY</span>
          <strong>{activePoint.city.city}</strong>
          <em>{activePoint.city.venue} · {activePoint.city.countryName}</em>
          <div className="wm-worldcup-map-inspector-stats">
            <span><b>{activePoint.count}</b><small>MATCHES</small></span>
            <span><b>{activePoint.city.capacity ? `${Math.round(activePoint.city.capacity / 1000)}k` : '--'}</b><small>CAPACITY</small></span>
            <span><b>{activePoint.weather ? `${activePoint.weather.current.tempC}°` : '--'}</b><small>{activePoint.weather?.current.condition || 'WEATHER'}</small></span>
            <span><b>{activePoint.weather?.current.windKph || '--'}</b><small>WIND KPH</small></span>
          </div>
          {nextCityMatch ? (
            <section className="wm-worldcup-map-inspector-next">
              <span>NEXT MATCH</span>
              <strong>{matchTitle(nextCityMatch)}</strong>
              <em>#{nextCityMatch.fifaMatchNumber || '--'} · {shortKickoff(nextCityMatch)} · {nextCityMatch.status.toUpperCase()}</em>
            </section>
          ) : null}
          {activePoint.weather ? (
            <section className="wm-worldcup-map-inspector-forecast">
              {activePoint.weather.forecast.slice(0, 3).map((item) => (
                <span key={item.date}><b>{item.lowC}°/{item.highC}°</b><small>{item.condition}</small></span>
              ))}
            </section>
          ) : null}
          <section className="wm-worldcup-map-inspector-matches">
            {activeMatches.slice(0, 5).map((match) => (
              <p key={match.id}>
                <b>#{match.fifaMatchNumber || '--'}</b>
                <span>{matchTitle(match)}</span>
                <em>{shortKickoff(match)}</em>
              </p>
            ))}
          </section>
        </aside>
      ) : null}
      <MapControls map={mapRef.current} />
      <div className="wm-worldcup-maplibre-legend">
        <span>Legend</span>
        <b className="upcoming" /> <em>Upcoming</em>
        <b className="next" /> <em>Next</em>
        <b className="selected" /> <em>Selected</em>
      </div>
      <div className="wm-worldcup-maplibre-status">{mapDegraded ? 'FALLBACK' : 'WEBGL'}</div>
    </div>
  );
}
