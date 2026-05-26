import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  kind?: 'radar' | 'intel' | 'alert';
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
const US_STATES_TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

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

const ALERT_EVENT_POINTS = [
  [-124.2, 40.8, 'red', 9], [-123.7, 39.7, 'red', 9], [-123.0, 38.2, 'red', 10], [-122.5, 37.8, 'red', 11],
  [-122.2, 37.4, 'red', 8], [-121.9, 36.8, 'red', 8], [-121.4, 36.0, 'red', 8], [-120.8, 35.4, 'red', 9],
  [-120.1, 34.9, 'red', 9], [-119.5, 34.4, 'red', 9], [-118.7, 34.1, 'red', 12], [-118.2, 33.8, 'red', 12],
  [-117.6, 33.2, 'red', 10], [-117.1, 32.7, 'red', 10], [-122.6, 45.5, 'red', 10], [-122.3, 47.6, 'red', 10],
  [-112.1, 33.5, 'red', 12], [-111.9, 40.8, 'red', 8], [-104.9, 39.7, 'red', 8], [-97.7, 30.3, 'red', 9],
  [-96.8, 32.8, 'red', 12], [-95.4, 29.8, 'red', 12], [-94.6, 29.4, 'red', 8], [-93.9, 29.8, 'red', 8],
  [-91.1, 30.4, 'red', 8], [-90.1, 29.9, 'red', 12], [-88.0, 30.7, 'red', 9], [-86.8, 30.4, 'red', 8],
  [-84.3, 30.4, 'red', 8], [-82.5, 27.9, 'red', 9], [-81.7, 30.3, 'red', 10], [-80.2, 25.8, 'red', 13],
  [-80.0, 26.6, 'red', 8], [-81.0, 28.5, 'red', 8], [-82.0, 29.2, 'red', 8], [-83.0, 32.1, 'red', 8],
  [-84.4, 33.8, 'red', 12], [-86.8, 33.5, 'red', 8], [-87.6, 41.9, 'red', 12], [-90.2, 38.6, 'red', 8],
  [-93.3, 44.9, 'red', 8], [-95.9, 41.3, 'red', 7], [-97.5, 35.5, 'red', 7], [-97.3, 37.7, 'red', 7],
  [-94.6, 39.1, 'red', 8], [-86.2, 39.8, 'red', 8], [-83.0, 42.3, 'red', 10], [-81.7, 41.5, 'red', 8],
  [-79.9, 40.4, 'red', 8], [-77.6, 43.1, 'red', 7], [-78.9, 42.9, 'red', 8], [-76.6, 39.3, 'red', 10],
  [-77.0, 38.9, 'red', 12], [-75.2, 39.9, 'red', 10], [-74.8, 40.2, 'red', 8], [-74.0, 40.7, 'red', 13],
  [-73.8, 41.0, 'red', 9], [-72.7, 41.8, 'red', 8], [-71.4, 41.8, 'red', 7], [-71.1, 42.4, 'red', 11],
  [-70.3, 43.7, 'red', 8], [-69.8, 44.6, 'red', 7], [-66.1, 18.4, 'red', 7], [-78.5, 35.8, 'red', 8],
  [-80.8, 35.2, 'red', 9], [-79.9, 36.1, 'red', 7], [-77.4, 37.5, 'red', 8], [-76.3, 36.9, 'red', 8],
  [-75.5, 35.8, 'red', 7], [-79.9, 32.8, 'red', 8], [-81.1, 32.1, 'red', 8], [-84.0, 35.9, 'red', 7],
  [-86.8, 36.2, 'red', 8], [-89.9, 35.1, 'red', 8], [-92.3, 34.8, 'red', 7], [-89.4, 43.1, 'red', 7],
  [-87.9, 43.0, 'red', 7], [-85.7, 42.9, 'red', 7], [-82.5, 27.3, 'red', 7], [-97.1, 49.9, 'red', 7],
  [-79.4, 43.7, 'red', 9], [-75.7, 45.4, 'red', 8], [-73.6, 45.5, 'red', 8], [-71.2, 46.8, 'red', 7],
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
    if (!map.getSource('worldcup-alert-points')) {
      map.addSource('worldcup-alert-points', { type: 'geojson', data: pointFeatures(ALERT_EVENT_POINTS) });
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
    if (!map.getLayer('worldcup-alert-points')) {
      map.addLayer({
        id: 'worldcup-alert-points',
        type: 'circle',
        source: 'worldcup-alert-points',
        paint: {
          'circle-color': '#ff5d62',
          'circle-opacity': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.2, 4, 6.8, 6, 9],
          'circle-stroke-color': '#ffb5b5',
          'circle-stroke-opacity': 0.72,
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
  kind: WorldCupOverlayPoint['kind'],
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
      kind,
      x: projected.x,
      y: projected.y,
      visible: projected.x > -120 && projected.x < width + 120 && projected.y > -90 && projected.y < height + 90,
    };
  });
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
  const [alertScreenPoints, setAlertScreenPoints] = useState<WorldCupOverlayPoint[]>([]);

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

    const syncPoints = () => {
      setScreenPoints(projectPoints(map, citiesRef.current, matchesRef.current, weatherByCityRef.current));
      setScreenLabels(projectLabels(map, COUNTRY_LABELS));
      setRadarScreenPoints(projectOverlayPoints(map, RADAR_CELLS, 'radar'));
      setIntelScreenPoints(projectOverlayPoints(map, INTEL_POINTS, 'intel'));
      setAlertScreenPoints(projectOverlayPoints(map, ALERT_EVENT_POINTS, 'alert'));
    };
    const resizeAndSync = () => {
      map.resize();
      map.triggerRepaint();
      syncPoints();
    };

    map.on('load', () => {
      setMapReady(true);
      loadUsStateBoundaries(map);
      ensureWorldMonitorOverlayLayers(map);
      resizeAndSync();
    });
    map.on('idle', () => {
      setMapReady(true);
      loadUsStateBoundaries(map);
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
          ensureWorldMonitorOverlayLayers(map);
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
      ensureWorldMonitorOverlayLayers(map);
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
    setScreenPoints(projectPoints(mapRef.current, cities, matches, weatherByCity));
    setScreenLabels(projectLabels(mapRef.current, COUNTRY_LABELS));
    setRadarScreenPoints(projectOverlayPoints(mapRef.current, RADAR_CELLS, 'radar'));
    setIntelScreenPoints(projectOverlayPoints(mapRef.current, INTEL_POINTS, 'intel'));
    setAlertScreenPoints(projectOverlayPoints(mapRef.current, ALERT_EVENT_POINTS, 'alert'));
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
        {alertScreenPoints.filter((point) => point.visible).map((point) => (
          <span
            key={point.id}
            className="wm-worldcup-map-alert-dot"
            style={{
              width: `${Math.max(7, point.weight)}px`,
              height: `${Math.max(7, point.weight)}px`,
              transform: `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`,
            }}
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
