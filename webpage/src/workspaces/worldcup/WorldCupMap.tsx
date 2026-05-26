import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
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

type WorldCupOverlayPoint = {
  id: string;
  tone: string;
  weight: number;
  x: number;
  y: number;
  visible: boolean;
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

const INTEL_POINTS = [
  [-123.1, 49.25, 'orange'], [-122.33, 47.61, 'blue'], [-122.42, 37.77, 'gold'], [-118.24, 34.05, 'orange'],
  [-112.07, 33.45, 'red'], [-104.99, 39.74, 'blue'], [-96.8, 32.78, 'orange'], [-95.36, 29.76, 'blue'],
  [-90.07, 29.95, 'gold'], [-87.62, 41.88, 'yellow'], [-84.39, 33.75, 'red'], [-80.19, 25.76, 'blue'],
  [-77.04, 38.9, 'orange'], [-74.0, 40.71, 'gold'], [-71.06, 42.36, 'blue'], [-99.13, 19.43, 'red'],
  [-103.35, 20.67, 'gold'], [-100.31, 25.68, 'blue'], [-79.38, 43.65, 'blue'], [-73.56, 45.5, 'yellow'],
  [-0.12, 51.5, 'blue'], [2.35, 48.86, 'orange'], [13.4, 52.52, 'blue'], [31.23, 30.04, 'orange'],
] as const;

const RADAR_CELLS = [
  [-126, 50, 'blue', 26], [-123, 48, 'blue', 20], [-121, 46, 'gold', 18], [-122, 37, 'blue', 18],
  [-118, 34, 'gold', 22], [-107, 39, 'blue', 14], [-100, 31, 'gold', 18], [-96, 33, 'blue', 18],
  [-90, 32, 'gold', 24], [-86, 35, 'blue', 22], [-82, 28, 'gold', 20], [-78, 36, 'blue', 28],
  [-74, 41, 'gold', 24], [-70, 44, 'blue', 16], [-102, 23, 'blue', 20], [-98, 20, 'gold', 16],
  [-77, 18, 'blue', 14], [-64, 32, 'blue', 12], [-8, 53, 'blue', 22], [0, 50, 'gold', 18],
  [7, 49, 'blue', 18], [15, 52, 'blue', 15], [121, 31, 'blue', 22], [139, 35, 'gold', 18],
] as const;

const ALERT_ZONES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: '乌克兰/乌克兰' },
      geometry: { type: 'Polygon', coordinates: [[[22, 45], [31, 45], [39, 49], [36, 52], [26, 52], [22, 49], [22, 45]]] },
    },
    {
      type: 'Feature',
      properties: { name: '伊朗/伊朗' },
      geometry: { type: 'Polygon', coordinates: [[[44, 25], [57, 24], [63, 30], [60, 37], [51, 39], [44, 34], [44, 25]]] },
    },
    {
      type: 'Feature',
      properties: { name: '苏丹/苏丹' },
      geometry: { type: 'Polygon', coordinates: [[[22, 9], [35, 9], [37, 17], [32, 22], [23, 20], [22, 9]]] },
    },
    {
      type: 'Feature',
      properties: { name: '加勒比监控' },
      geometry: { type: 'Polygon', coordinates: [[[-86, 18], [-77, 18], [-73, 23], [-80, 27], [-87, 24], [-86, 18]]] },
    },
  ],
} as any;

function pointFeatures(points: readonly (readonly [number, number, string, number?])[]) {
  return {
    type: 'FeatureCollection',
    features: points.map(([lon, lat, tone, weight], index) => ({
      type: 'Feature',
      properties: { id: index, tone, weight: weight || 10 },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })),
  } as any;
}

function deckColor(tone: string, alpha = 190): [number, number, number, number] {
  if (tone === 'blue') return [8, 189, 247, alpha];
  if (tone === 'gold' || tone === 'orange') return [255, 157, 0, alpha];
  if (tone === 'yellow') return [244, 231, 0, alpha];
  if (tone === 'red') return [255, 76, 76, alpha];
  return [255, 157, 0, alpha];
}

function buildWorldCupDeckLayers() {
  const radarData = RADAR_CELLS.map(([longitude, latitude, tone, weight], id) => ({ id, longitude, latitude, tone, weight }));
  const intelData = INTEL_POINTS.map(([longitude, latitude, tone], id) => ({ id, longitude, latitude, tone }));
  return [
    new ScatterplotLayer({
      id: 'worldcup-radar-deck',
      data: radarData,
      getPosition: (d: any) => [d.longitude, d.latitude],
      getRadius: (d: any) => Math.max(42000, d.weight * 11500),
      getFillColor: (d: any) => deckColor(d.tone, d.tone === 'blue' ? 82 : 96),
      getLineColor: (d: any) => deckColor(d.tone, 110),
      lineWidthMinPixels: 0,
      radiusMinPixels: 10,
      radiusMaxPixels: 42,
      stroked: false,
      filled: true,
      opacity: 0.82,
      pickable: false,
    }),
    new GeoJsonLayer({
      id: 'worldcup-alert-zones-deck',
      data: ALERT_ZONES,
      filled: true,
      stroked: true,
      getFillColor: [200, 14, 22, 92],
      getLineColor: [255, 34, 43, 210],
      getLineWidth: 2,
      lineWidthMinPixels: 1,
      pickable: false,
    }),
    new ScatterplotLayer({
      id: 'worldcup-intel-points-deck',
      data: intelData,
      getPosition: (d: any) => [d.longitude, d.latitude],
      getRadius: 26000,
      getFillColor: (d: any) => deckColor(d.tone, 210),
      getLineColor: [0, 0, 0, 150],
      lineWidthMinPixels: 1,
      radiusMinPixels: 5,
      radiusMaxPixels: 13,
      stroked: true,
      filled: true,
      pickable: false,
    }),
  ];
}

function firstSymbolLayerId(map: MapLibreMap) {
  const layers = map.getStyle().layers || [];
  return layers.find((layer) => layer.type === 'symbol')?.id;
}

function buildWorldMonitorRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      countries: {
        type: 'geojson',
        data: COUNTRIES_GEOJSON,
      },
      cartoDark: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© CARTO © OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#141516' },
      },
      {
        id: 'country-fill-base',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': '#1a1d1d',
          'fill-opacity': 0.88,
        },
      },
      {
        id: 'country-border-base',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': '#363a3b',
          'line-opacity': 0.62,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 4, 1.1],
        },
      },
      {
        id: 'carto-dark-raster',
        type: 'raster',
        source: 'cartoDark',
        paint: {
          'raster-opacity': 1,
          'raster-saturation': -0.1,
          'raster-contrast': 0.1,
          'raster-brightness-min': 0,
          'raster-brightness-max': 0.98,
        },
      },
    ],
  };
}

function ensureWorldMonitorOverlayLayers(map: MapLibreMap) {
  if (!map.getStyle()) return;
  try {
    const beforeId = firstSymbolLayerId(map);
    if (!map.getSource('worldcup-alert-zones')) {
      map.addSource('worldcup-alert-zones', { type: 'geojson', data: ALERT_ZONES });
    }
    if (!map.getSource('worldcup-radar-cells')) {
      map.addSource('worldcup-radar-cells', { type: 'geojson', data: pointFeatures(RADAR_CELLS) });
    }
    if (!map.getSource('worldcup-intel-points')) {
      map.addSource('worldcup-intel-points', { type: 'geojson', data: pointFeatures(INTEL_POINTS) });
    }
    if (!map.getLayer('worldcup-radar-blue')) {
      map.addLayer({
        id: 'worldcup-radar-blue',
        type: 'circle',
        source: 'worldcup-radar-cells',
        filter: ['==', ['get', 'tone'], 'blue'],
        paint: {
          'circle-color': '#08bdf7',
          'circle-opacity': 0.36,
          'circle-blur': 0.55,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['*', ['get', 'weight'], 0.7], 4, ['*', ['get', 'weight'], 1.65]],
        },
      }, beforeId);
    }
    if (!map.getLayer('worldcup-radar-gold')) {
      map.addLayer({
        id: 'worldcup-radar-gold',
        type: 'circle',
        source: 'worldcup-radar-cells',
        filter: ['==', ['get', 'tone'], 'gold'],
        paint: {
          'circle-color': '#ffa600',
          'circle-opacity': 0.42,
          'circle-blur': 0.48,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['*', ['get', 'weight'], 0.62], 4, ['*', ['get', 'weight'], 1.5]],
        },
      }, beforeId);
    }
    if (!map.getLayer('worldcup-alert-zone-fill')) {
      map.addLayer({
        id: 'worldcup-alert-zone-fill',
        type: 'fill',
        source: 'worldcup-alert-zones',
        paint: {
          'fill-color': '#c80e16',
          'fill-opacity': 0.46,
        },
      }, beforeId);
    }
    if (!map.getLayer('worldcup-alert-zone-line')) {
      map.addLayer({
        id: 'worldcup-alert-zone-line',
        type: 'line',
        source: 'worldcup-alert-zones',
        paint: {
          'line-color': '#ff222b',
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.1, 4, 2.4],
        },
      }, beforeId);
    }
    if (!map.getLayer('worldcup-intel-points')) {
      map.addLayer({
        id: 'worldcup-intel-points',
        type: 'circle',
        source: 'worldcup-intel-points',
        paint: {
          'circle-color': [
            'match',
            ['get', 'tone'],
            'red', '#ff4c4c',
            'orange', '#ff9d00',
            'yellow', '#f4e700',
            'blue', '#4c7bd9',
            '#ff9d00',
          ],
          'circle-opacity': 0.82,
          'circle-blur': 0.08,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.2, 4, 9.5],
          'circle-stroke-color': 'rgba(0,0,0,0.58)',
          'circle-stroke-width': 1,
        },
      }, beforeId);
    }
  } catch {
    window.requestAnimationFrame(() => ensureWorldMonitorOverlayLayers(map));
  }
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

function projectLabels(map: MapLibreMap | null, labels: WorldCupMapLabel[]): WorldCupScreenLabel[] {
  if (!map) return [];
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  return labels.map((label) => {
    const projected = map.project([label.lon, label.lat]);
    return {
      ...label,
      x: projected.x,
      y: projected.y,
      visible: projected.x > -100 && projected.x < width + 100 && projected.y > -60 && projected.y < height + 60,
    };
  });
}

function projectOverlayPoints(
  map: MapLibreMap | null,
  points: readonly (readonly [number, number, string, number?])[],
): WorldCupOverlayPoint[] {
  if (!map) return [];
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  return points.map(([lon, lat, tone, weight], index) => {
    const projected = map.project([lon, lat]);
    return {
      id: `${tone}-${index}`,
      tone,
      weight: weight || 10,
      x: projected.x,
      y: projected.y,
      visible: projected.x > -120 && projected.x < width + 120 && projected.y > -90 && projected.y < height + 90,
    };
  });
}

function LayerPanel() {
  const layers = [
    ['✓', '🎯', '伊朗袭击', 'LIVE'],
    ['✓', '🎯', '情报热点', 'LIVE'],
    ['✓', '⌁', '天气雷达', 'FORECAST'],
    ['✓', '×', '冲突区', 'WATCH'],
    ['✓', '🏟', '世界杯城市', 'ACTIVE'],
    ['', '⚽', '比赛日程', 'LIVE'],
    ['', '$', '赔率/市场', 'LOCAL DB'],
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
      <button type="button" onClick={() => map?.easeTo({ center: [-67, 39], zoom: 2.05, pitch: 0, bearing: 0 })} aria-label="Reset view">⌂</button>
    </div>
  );
}

export function WorldCupMap({ cities, matches, weather, nextMatch, selectedCityId, selectedMatchId, onSelectCity }: WorldCupMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const citiesRef = useRef(cities);
  const matchesRef = useRef(matches);
  const weatherByCityRef = useRef(new Map<string, WorldCupCityWeather>());
  const fallbackAppliedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapDegraded, setMapDegraded] = useState(false);
  const [screenPoints, setScreenPoints] = useState<WorldCupMapPoint[]>([]);
  const [screenLabels, setScreenLabels] = useState<WorldCupScreenLabel[]>([]);
  const [radarScreenPoints, setRadarScreenPoints] = useState<WorldCupOverlayPoint[]>([]);
  const [intelScreenPoints, setIntelScreenPoints] = useState<WorldCupOverlayPoint[]>([]);

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
      style: buildWorldMonitorRasterStyle(),
      center: [-67, 39],
      zoom: 2.05,
      minZoom: 1.45,
      maxZoom: 7,
      maxBounds: [[-178, -38], [70, 82]],
      renderWorldCopies: false,
      attributionControl: false,
      interactive: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      canvasContextAttributes: { powerPreference: 'high-performance' },
    });
    mapRef.current = map;

    const initDeckOverlay = () => {
      if (deckOverlayRef.current) {
        deckOverlayRef.current.setProps({ layers: buildWorldCupDeckLayers() });
        return;
      }
      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: buildWorldCupDeckLayers(),
        pickingRadius: 10,
        useDevicePixels: window.devicePixelRatio > 2 ? 2 : true,
        onError: (error: Error) => {
          console.warn('[WorldCupMap] deck.gl overlay render error:', error.message);
        },
      });
      map.addControl(overlay as unknown as maplibregl.IControl);
      deckOverlayRef.current = overlay;
    };

    const syncPoints = () => {
      setScreenPoints(projectPoints(map, citiesRef.current, matchesRef.current, weatherByCityRef.current));
      setScreenLabels(projectLabels(map, COUNTRY_LABELS));
      setRadarScreenPoints(projectOverlayPoints(map, RADAR_CELLS));
      setIntelScreenPoints(projectOverlayPoints(map, INTEL_POINTS));
    };
    const resizeAndSync = () => {
      map.resize();
      map.triggerRepaint();
      syncPoints();
    };

    map.on('load', () => {
      setMapReady(true);
      initDeckOverlay();
      ensureWorldMonitorOverlayLayers(map);
      resizeAndSync();
    });
    map.on('idle', () => {
      setMapReady(true);
      initDeckOverlay();
      ensureWorldMonitorOverlayLayers(map);
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
          initDeckOverlay();
          ensureWorldMonitorOverlayLayers(map);
          resizeAndSync();
        });
      }
    };
    map.on('error', onError);

    const initialFrame = window.requestAnimationFrame(resizeAndSync);
    const settleTimer = window.setTimeout(() => {
      setMapReady(true);
      initDeckOverlay();
      ensureWorldMonitorOverlayLayers(map);
      resizeAndSync();
    }, 500);
    const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(resizeAndSync));
    if (rootRef.current) resizeObserver.observe(rootRef.current);

    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.clearTimeout(settleTimer);
      resizeObserver.disconnect();
      if (deckOverlayRef.current) {
        try {
          map.removeControl(deckOverlayRef.current as unknown as maplibregl.IControl);
        } catch {
          deckOverlayRef.current.finalize();
        }
        deckOverlayRef.current = null;
      }
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
    setScreenLabels(projectLabels(mapRef.current, COUNTRY_LABELS));
    setRadarScreenPoints(projectOverlayPoints(mapRef.current, RADAR_CELLS));
    setIntelScreenPoints(projectOverlayPoints(mapRef.current, INTEL_POINTS));
  }, [cities, matches, selectedCityId, weatherByCity]);

  return (
    <div ref={rootRef} className={`wm-worldcup-map wm-worldcup-maplibre ${mapReady ? 'ready' : ''} ${mapDegraded ? 'degraded' : ''}`}>
      <div ref={mapHostRef} className="wm-worldcup-maplibre-host" />
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
      <div className="wm-worldcup-map-radar-layer">
        {radarScreenPoints.filter((point) => point.visible).map((point) => (
          <span
            key={point.id}
            className={`wm-worldcup-map-radar-cell ${point.tone}`}
            style={{
              width: `${Math.max(24, point.weight * 2.7)}px`,
              height: `${Math.max(18, point.weight * 2.1)}px`,
              transform: `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`,
            }}
          />
        ))}
        {intelScreenPoints.filter((point) => point.visible).map((point) => (
          <span
            key={point.id}
            className={`wm-worldcup-map-intel-dot ${point.tone}`}
            style={{ transform: `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)` }}
          />
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
        <b className="alert" /> <em>高度警报</em>
        <b className="next" /> <em>升高</em>
        <b className="watch" /> <em>监控中</em>
        <b className="base" /> <em>基地</em>
        <b className="nuclear" /> <em>核设施</em>
      </div>
      <div className="wm-worldcup-maplibre-status">{mapDegraded ? 'FALLBACK' : 'WEBGL'}</div>
    </div>
  );
}
