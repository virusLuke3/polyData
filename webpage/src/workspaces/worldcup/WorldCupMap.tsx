import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { geoMercator, geoPath } from 'd3-geo';
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-50m.json';
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

type WorldCupMapLabel = {
  id: string;
  text: string;
  lon: number;
  lat: number;
  size?: 'small' | 'normal' | 'large';
};

type WorldCupScreenLabel = WorldCupMapLabel & {
  x: number;
  y: number;
  visible: boolean;
};

type WorldCupMapSize = {
  width: number;
  height: number;
};

type HostAtlasData = {
  us: any;
  canada: any;
  mexico: any;
};

const IMPORTANT_CITY_IDS = new Set(['mexico-city', 'new-york-new-jersey', 'dallas', 'los-angeles']);

const COUNTRY_LABELS: WorldCupMapLabel[] = [
  { id: 'us', text: '美国/美国', lon: -101, lat: 38, size: 'normal' },
  { id: 'ca', text: '加拿大/加拿大', lon: -104, lat: 57, size: 'normal' },
  { id: 'mx', text: '墨西哥/墨西哥', lon: -102, lat: 23, size: 'normal' },
  { id: 'greenland', text: '格陵兰', lon: -42, lat: 72, size: 'small' },
  { id: 'cuba', text: '古巴', lon: -78, lat: 21.5, size: 'small' },
  { id: 'guatemala', text: '危地马拉', lon: -90, lat: 15.6, size: 'small' },
  { id: 'colombia', text: '哥伦比亚', lon: -73, lat: 4, size: 'small' },
  { id: 'brazil', text: '巴西', lon: -53, lat: -9, size: 'small' },
];

const COUNTRIES_GEOJSON = feature(countriesAtlas as any, (countriesAtlas as any).objects.countries) as any;
const US_STATES_TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const LOCAL_US_STATES_TOPOJSON_URL = '/map-data/us-states-10m.json';
const LOCAL_CANADA_PROVINCES_GEOJSON_URL = '/map-data/canada-provinces.geojson';
const LOCAL_MEXICO_STATES_GEOJSON_URL = '/map-data/mexico-states.geojson';

const HOST_ATLAS_BOUNDS = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[-141, 12], [-52, 12], [-52, 73], [-141, 73], [-141, 12]]],
  },
  properties: {},
} as any;

function firstSymbolLayerId(map: MapLibreMap) {
  const layers = map.getStyle().layers || [];
  return layers.find((layer) => layer.type === 'symbol')?.id;
}

function buildWorldMonitorRasterStyle(): StyleSpecification | string {
  return '/map-styles/worldcup-happy-dark.json';
}

function buildWorldCupMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      countries: {
        type: 'geojson',
        data: COUNTRIES_GEOJSON,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#101112' },
      },
      {
        id: 'country-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': '#1b1d1e',
          'fill-opacity': 0.92,
        },
      },
      {
        id: 'country-border',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': '#36393a',
          'line-opacity': 0.74,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            0.35,
            4,
            0.85,
            7,
            1.45,
          ],
        },
      },
    ],
  };
}

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

function createHostAtlasProjection(size: WorldCupMapSize) {
  const leftInset = Math.min(310, size.width * 0.16);
  const rightInset = Math.min(420, size.width * 0.21);
  return geoMercator().fitExtent(
    [[leftInset, 18], [Math.max(leftInset + 1, size.width - rightInset), Math.max(140, size.height - 8)]],
    HOST_ATLAS_BOUNDS,
  );
}

function projectHostCoordinate(size: WorldCupMapSize, lon: number, lat: number) {
  const projected = createHostAtlasProjection(size)([lon, lat]);
  return projected || [Number.NaN, Number.NaN];
}

function projectPoints(
  map: MapLibreMap | null,
  size: WorldCupMapSize,
  cities: WorldCupVenueCity[],
  matches: WorldCupMatch[],
  weatherByCity: Map<string, WorldCupCityWeather>,
): WorldCupMapPoint[] {
  if (!map) return [];
  const { width, height } = size;
  return cities.map((city) => {
    const [x, y] = projectHostCoordinate(size, city.longitude, city.latitude);
    const count = matches.filter((match) => match.cityId === city.id).length;
    return {
      city,
      weather: weatherByCity.get(city.id) || null,
      count,
      status: cityStatus(city.id, matches),
      x,
      y,
      visible: Number.isFinite(x) && Number.isFinite(y) && x > -120 && x < width + 120 && y > -90 && y < height + 90,
    };
  });
}

function projectLabels(map: MapLibreMap | null, size: WorldCupMapSize, labels: WorldCupMapLabel[]): WorldCupScreenLabel[] {
  if (!map) return [];
  const { width, height } = size;
  return labels.map((label) => {
    const [x, y] = projectHostCoordinate(size, label.lon, label.lat);
    return {
      ...label,
      x,
      y,
      visible: Number.isFinite(x) && Number.isFinite(y) && x > -100 && x < width + 100 && y > -60 && y < height + 60,
    };
  });
}

function buildHostAtlasPaths(data: HostAtlasData | null, size: WorldCupMapSize) {
  if (!data || size.width < 200 || size.height < 200) return null;
  const path = geoPath(createHostAtlasProjection(size));
  const toPath = (item: any) => path(item) || '';
  return {
    us: data.us.features.map((item: any, index: number) => ({ id: `us-${item.id || index}`, d: toPath(item) })).filter((item: { d: string }) => item.d),
    canada: data.canada.features.map((item: any, index: number) => ({ id: `ca-${item.properties?.name || index}`, d: toPath(item) })).filter((item: { d: string }) => item.d),
    mexico: data.mexico.features.map((item: any, index: number) => ({ id: `mx-${item.properties?.name || index}`, d: toPath(item) })).filter((item: { d: string }) => item.d),
  };
}

function HostAtlasSvg({ data, size }: { data: HostAtlasData | null; size: WorldCupMapSize }) {
  const paths = useMemo(() => buildHostAtlasPaths(data, size), [data, size]);
  return (
    <svg className="wm-worldcup-host-atlas-svg" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
      <rect className="wm-worldcup-host-atlas-water" x="0" y="0" width={size.width} height={size.height} />
      {paths ? (
        <g>
          <g className="wm-worldcup-host-atlas-country canada">
            {paths.canada.map((item: { id: string; d: string }) => <path key={item.id} d={item.d} />)}
          </g>
          <g className="wm-worldcup-host-atlas-country us">
            {paths.us.map((item: { id: string; d: string }) => <path key={item.id} d={item.d} />)}
          </g>
          <g className="wm-worldcup-host-atlas-country mexico">
            {paths.mexico.map((item: { id: string; d: string }) => <path key={item.id} d={item.d} />)}
          </g>
          <g className="wm-worldcup-host-atlas-border">
            {[...paths.canada, ...paths.us, ...paths.mexico].map((item: { id: string; d: string }) => <path key={`line-${item.id}`} d={item.d} />)}
          </g>
        </g>
      ) : null}
    </svg>
  );
}

function loadUsStateBoundaries(map: MapLibreMap) {
  if (map.getSource('us-state-boundaries')) return;
  fetch(US_STATES_TOPOJSON_URL)
    .then((response) => response.json())
    .then((topology) => {
      if (!map.getStyle() || map.getSource('us-state-boundaries')) return;
      const states = feature(topology, topology.objects.states) as any;
      map.addSource('us-state-boundaries', {
        type: 'geojson',
        data: states,
      });
      const beforeId = firstSymbolLayerId(map);
      map.addLayer({
        id: 'us-state-boundary-fill',
        type: 'fill',
        source: 'us-state-boundaries',
        paint: {
          'fill-color': '#252829',
          'fill-opacity': 0.05,
        },
      }, beforeId);
      map.addLayer({
        id: 'us-state-boundary-line',
        type: 'line',
        source: 'us-state-boundaries',
        paint: {
          'line-color': '#4c5051',
          'line-opacity': 0.66,
          'line-dasharray': [3, 3],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.55, 4, 1.25, 6, 1.75],
        },
      }, beforeId);
    })
    .catch(() => {});
}

function LayerPanel() {
  const layers = [
    ['✓', '◎', 'HOST COUNTRIES', 'USA · CAN · MEX'],
    ['✓', '⌗', 'ADMIN REGIONS', 'STATE/PROVINCE'],
    ['✓', '●', 'HOST CITIES', '16'],
    ['✓', '⚽', 'MATCH SCHEDULE', 'LIVE'],
    ['✓', '$', 'POLYMARKET MARKETS', 'LOCAL DB'],
    ['', '☁', 'WEATHER WATCH', 'FORECAST'],
    ['', '▦', 'SQUAD LISTS', 'PENDING'],
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
      <button type="button" onClick={() => map?.easeTo({ center: [-96, 39], zoom: 2.55, pitch: 0, bearing: 0 })} aria-label="Reset view">⌂</button>
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
  const [mapSize, setMapSize] = useState<WorldCupMapSize>({ width: 1600, height: 640 });
  const [atlasData, setAtlasData] = useState<HostAtlasData | null>(null);
  const [screenPoints, setScreenPoints] = useState<WorldCupMapPoint[]>([]);
  const [screenLabels, setScreenLabels] = useState<WorldCupScreenLabel[]>([]);

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
    let cancelled = false;
    Promise.all([
      fetch(LOCAL_US_STATES_TOPOJSON_URL).then((response) => response.json()).then((topology) => feature(topology, topology.objects.states) as any),
      fetch(LOCAL_CANADA_PROVINCES_GEOJSON_URL).then((response) => response.json()),
      fetch(LOCAL_MEXICO_STATES_GEOJSON_URL).then((response) => response.json()),
    ])
      .then(([us, canada, mexico]) => {
        if (!cancelled) setAtlasData({ us, canada, mexico });
      })
      .catch(() => {
        if (!cancelled) setAtlasData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host || mapRef.current) return undefined;
    const map = new maplibregl.Map({
      container: host,
      style: buildWorldMonitorRasterStyle(),
      center: [-96, 39],
      zoom: 2.72,
      minZoom: 1.85,
      maxZoom: 7,
      maxBounds: [[-172, 5], [-38, 84]],
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
      const canvas = map.getCanvas();
      const size = {
        width: canvas.clientWidth || canvas.width || 1600,
        height: canvas.clientHeight || canvas.height || 640,
      };
      setMapSize(size);
      setScreenPoints(projectPoints(map, size, citiesRef.current, matchesRef.current, weatherByCityRef.current));
      setScreenLabels(projectLabels(map, size, COUNTRY_LABELS));
    };
    const resizeAndSync = () => {
      map.resize();
      map.triggerRepaint();
      syncPoints();
    };

    map.on('load', () => {
      setMapReady(true);
      loadUsStateBoundaries(map);
      resizeAndSync();
    });
    map.on('idle', () => {
      setMapReady(true);
      loadUsStateBoundaries(map);
      resizeAndSync();
    });
    map.on('move', syncPoints);
    map.on('zoom', syncPoints);
    map.on('resize', syncPoints);
    map.on('styledata', resizeAndSync);

    const onError = (event: { error?: Error; message?: string }) => {
      const message = event.error?.message || event.message || '';
      if (!message || fallbackAppliedRef.current) return;
      if (/Could not load style|Style is not done loading|invalid style/i.test(message)) {
        fallbackAppliedRef.current = true;
        setMapDegraded(true);
        map.setStyle(buildWorldCupMapStyle(), { diff: false });
        window.requestAnimationFrame(() => {
          loadUsStateBoundaries(map);
          resizeAndSync();
        });
      }
    };
    map.on('error', onError);

    const initialFrame = window.requestAnimationFrame(resizeAndSync);
    const settleTimer = window.setTimeout(() => {
      setMapReady(true);
      loadUsStateBoundaries(map);
      resizeAndSync();
    }, 500);
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
    setScreenPoints(projectPoints(mapRef.current, mapSize, cities, matches, weatherByCity));
    setScreenLabels(projectLabels(mapRef.current, mapSize, COUNTRY_LABELS));
  }, [cities, matches, mapSize, selectedCityId, weatherByCity]);

  return (
    <div ref={rootRef} className={`wm-worldcup-map wm-worldcup-maplibre ${mapReady ? 'ready' : ''} ${mapDegraded ? 'degraded' : ''}`}>
      <div ref={mapHostRef} className="wm-worldcup-maplibre-host" />
      <HostAtlasSvg data={atlasData} size={mapSize} />
      <LayerPanel />
      <div className="wm-worldcup-map-country-label-layer">
        {screenLabels.filter((label) => label.visible).map((label) => (
          <span
            className={`wm-worldcup-map-country-label ${label.size || 'normal'}`}
            key={label.id}
            style={{ transform: `translate(${Math.round(label.x)}px, ${Math.round(label.y)}px)` }}
          >
            {label.text}
          </span>
        ))}
      </div>
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
        <span>图例</span>
        <b className="admin" /> <em>行政区划</em>
        <b className="host" /> <em>主办城市</em>
        <b className="next" /> <em>下一场</em>
        <b className="selected" /> <em>已选择</em>
      </div>
      <div className="wm-worldcup-maplibre-status">{mapDegraded ? 'FALLBACK' : 'WEBGL'}</div>
    </div>
  );
}
