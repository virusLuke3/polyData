import type { PickingInfo } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-50m.json';
import { OPENFREEMAP_DARK_STYLE } from '@/config/weatherBasemap';
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

type HostCountryKey = 'us' | 'canada' | 'mexico';
type WorldCupLayerKey = 'cities' | 'schedule' | 'weather' | 'markets' | 'odds' | 'transit' | 'teams';

type MapRegionHover = {
  region: string;
  country: string;
  screenX: number;
  screenY: number;
};

type CitySignal = {
  type: 'host-city';
  city: WorldCupVenueCity;
  weather: WorldCupCityWeather | null;
  matches: WorldCupMatch[];
  nextMatch: WorldCupMatch | null;
  selected: boolean;
  next: boolean;
  important: boolean;
  marketCount: number;
  oddsCount: number;
  weatherRisk: number;
};

type PointSignal = {
  type: 'weather' | 'market' | 'odds' | 'transit' | 'team';
  id: string;
  city: WorldCupVenueCity;
  label: string;
  sublabel: string;
  lon: number;
  lat: number;
  weight: number;
};

type SchedulePath = {
  type: 'schedule';
  id: string;
  city: WorldCupVenueCity;
  match: WorldCupMatch;
  path: [number, number][];
  selected: boolean;
  next: boolean;
};

type DeckObject = CitySignal | PointSignal | SchedulePath;

type EnabledLayers = Record<WorldCupLayerKey, boolean>;

const IMPORTANT_CITY_IDS = new Set(['mexico-city', 'new-york-new-jersey', 'dallas', 'los-angeles']);
const COUNTRIES_GEOJSON = feature(countriesAtlas as any, (countriesAtlas as any).objects.countries) as any;
const LOCAL_US_STATES_TOPOJSON_URL = '/map-data/us-states-10m.json';
const LOCAL_CANADA_PROVINCES_GEOJSON_URL = '/map-data/canada-provinces.geojson';
const LOCAL_MEXICO_STATES_GEOJSON_URL = '/map-data/mexico-states.geojson';
const LOCAL_WORLD_COUNTRIES_GEOJSON_URL = '/map-data/world-countries.geojson';
const WORLDCUP_ATLAS_CENTER: [number, number] = [-95, 38];
const WORLDCUP_ATLAS_ZOOM = 2.98;
const PMTILES_STYLE_URL = import.meta.env.VITE_WORLDCUP_PMTILES_STYLE_URL || import.meta.env.VITE_PMTILES_STYLE_URL || '';

const HOST_COUNTRY_META: Record<string, { key: HostCountryKey; iso2: string; label: string }> = {
  '840': { key: 'us', iso2: 'US', label: 'UNITED STATES' },
  '124': { key: 'canada', iso2: 'CA', label: 'CANADA' },
  '484': { key: 'mexico', iso2: 'MX', label: 'MEXICO' },
};
const HOST_COUNTRY_ISO2 = new Set(Object.values(HOST_COUNTRY_META).map((item) => item.iso2));

const DEFAULT_ENABLED_LAYERS: EnabledLayers = {
  cities: true,
  schedule: false,
  weather: true,
  markets: true,
  odds: true,
  transit: false,
  teams: false,
};

const COLORS = {
  city: [203, 210, 213, 222] as [number, number, number, number],
  cityLine: [255, 255, 255, 208] as [number, number, number, number],
  selected: [78, 214, 242, 232] as [number, number, number, number],
  selectedDim: [78, 214, 242, 52] as [number, number, number, number],
  next: [242, 184, 75, 230] as [number, number, number, number],
  nextDim: [242, 184, 75, 48] as [number, number, number, number],
  weather: [55, 175, 220, 68] as [number, number, number, number],
  market: [98, 190, 255, 155] as [number, number, number, number],
  odds: [244, 183, 70, 172] as [number, number, number, number],
  transit: [155, 164, 166, 132] as [number, number, number, number],
  team: [48, 218, 186, 122] as [number, number, number, number],
  route: [242, 184, 75, 72] as [number, number, number, number],
};

function firstSymbolLayerId(map: MapLibreMap) {
  const layers = map.getStyle().layers || [];
  return layers.find((layer) => layer.type === 'symbol')?.id;
}

function applyWorldMonitorMapPaint(map: MapLibreMap) {
  const layers = map.getStyle().layers || [];
  layers.forEach((layer) => {
    if (layer.id.startsWith('country-') || layer.id.startsWith('wc-')) return;
    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', '#111111');
      } else if (layer.type === 'fill') {
        const id = layer.id.toLowerCase();
        if (/water|ocean|lake|river/.test(id)) {
          map.setPaintProperty(layer.id, 'fill-color', '#090909');
          map.setPaintProperty(layer.id, 'fill-opacity', 1);
        } else {
          map.setPaintProperty(layer.id, 'fill-color', '#242424');
          map.setPaintProperty(layer.id, 'fill-opacity', 0.94);
        }
      } else if (layer.type === 'line') {
        const id = layer.id.toLowerCase();
        const boundary = /boundary|admin|border|state|province/.test(id);
        map.setPaintProperty(layer.id, 'line-color', boundary ? '#8b8f90' : '#55595a');
        map.setPaintProperty(layer.id, 'line-opacity', boundary ? 0.52 : 0.28);
        if (boundary) {
          map.setPaintProperty(layer.id, 'line-width', ['interpolate', ['linear'], ['zoom'], 2, 0.72, 4, 1.1, 6, 1.48]);
        }
      } else if (layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', '#8d8f90');
        map.setPaintProperty(layer.id, 'text-halo-color', '#050505');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.6);
        map.setPaintProperty(layer.id, 'text-opacity', ['interpolate', ['linear'], ['zoom'], 2, 0.48, 3, 0.66, 5, 0.82]);
      }
    } catch {
      // Some third-party style layers do not expose every paint property.
    }
  });
}

function buildLocalFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      countries: {
        type: 'geojson',
        data: LOCAL_WORLD_COUNTRIES_GEOJSON_URL,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#090909' },
      },
      {
        id: 'country-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': '#202020',
          'fill-opacity': 0.96,
        },
      },
      {
        id: 'country-border',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': '#8a8f90',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.44, 4, 0.62, 6, 0.76],
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.72, 4, 1.05, 7, 1.42],
        },
      },
    ],
  };
}

function primaryBasemapStyle(): string {
  return PMTILES_STYLE_URL || OPENFREEMAP_DARK_STYLE;
}

function hostCountriesGeoJson() {
  return {
    type: 'FeatureCollection',
    features: (COUNTRIES_GEOJSON.features || [])
      .filter((item: any) => HOST_COUNTRY_META[String(item.id)])
      .map((item: any) => {
        const meta = HOST_COUNTRY_META[String(item.id)]!;
        return {
          ...item,
          properties: {
            ...(item.properties || {}),
            hostKey: meta.key,
            iso2: meta.iso2,
            name: meta.label,
            'ISO3166-1-Alpha-2': meta.iso2,
          },
        };
      }),
  } as any;
}

function addLayerSafe(map: MapLibreMap, layer: any, beforeId?: string) {
  if (map.getLayer(layer.id)) return;
  try {
    map.addLayer(layer, beforeId);
  } catch {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
}

function addSourceSafe(map: MapLibreMap, id: string, data: any) {
  if (map.getSource(id)) return;
  map.addSource(id, { type: 'geojson', data });
}

function setupCountryHover(map: MapLibreMap, setRegionHover: (hover: MapRegionHover | null) => void) {
  if ((map as any).__worldCupCountryHoverSetup) return;
  (map as any).__worldCupCountryHoverSetup = true;
  let hoveredIso2 = '';

  const clearHover = () => {
    hoveredIso2 = '';
    map.getCanvas().style.cursor = '';
    setRegionHover(null);
    const noMatch: any = ['==', ['get', 'ISO3166-1-Alpha-2'], ''];
    if (map.getLayer('country-hover-fill')) map.setFilter('country-hover-fill', noMatch);
    if (map.getLayer('country-hover-border')) map.setFilter('country-hover-border', noMatch);
  };

  map.on('mousemove', (event) => {
    if (!map.getLayer('country-interactive')) return;
    const features = map.queryRenderedFeatures(event.point, { layers: ['country-interactive'] });
    const props = features[0]?.properties as Record<string, string> | undefined;
    const iso2 = props?.['ISO3166-1-Alpha-2'] || '';
    if (!iso2) {
      if (hoveredIso2) clearHover();
      return;
    }

    if (iso2 !== hoveredIso2) {
      hoveredIso2 = iso2;
      const filter: any = ['==', ['get', 'ISO3166-1-Alpha-2'], iso2];
      if (map.getLayer('country-hover-fill')) map.setFilter('country-hover-fill', filter);
      if (map.getLayer('country-hover-border')) map.setFilter('country-hover-border', filter);
      map.getCanvas().style.cursor = 'pointer';
    }

    const canvasRect = map.getCanvas().getBoundingClientRect();
    setRegionHover({
      region: props?.name || iso2,
      country: HOST_COUNTRY_ISO2.has(iso2) ? `${iso2} HOST COUNTRY` : iso2,
      screenX: event.point.x + canvasRect.left,
      screenY: event.point.y + canvasRect.top,
    });
  });

  map.on('mouseout', clearHover);
}

async function loadMapSupportLayers(map: MapLibreMap, setRegionHover: (hover: MapRegionHover | null) => void) {
  if (!map.getStyle() || (map as any).__worldCupSupportLayersLoading) return;
  (map as any).__worldCupSupportLayersLoading = true;
  const beforeId = firstSymbolLayerId(map);
  try {
    addSourceSafe(map, 'country-boundaries', LOCAL_WORLD_COUNTRIES_GEOJSON_URL);
    addLayerSafe(map, {
      id: 'country-interactive',
      type: 'fill',
      source: 'country-boundaries',
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': 0,
      },
    }, beforeId);
    addLayerSafe(map, {
      id: 'country-hover-fill',
      type: 'fill',
      source: 'country-boundaries',
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': 0.05,
      },
      filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
    }, beforeId);
    addLayerSafe(map, {
      id: 'country-hover-border',
      type: 'line',
      source: 'country-boundaries',
      paint: {
        'line-color': '#ffffff',
        'line-opacity': 0.22,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.15, 4, 1.55, 6, 2.05],
      },
      filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
    }, beforeId);
    addLayerSafe(map, {
      id: 'country-highlight-fill',
      type: 'fill',
      source: 'country-boundaries',
      paint: {
        'fill-color': '#3b82f6',
        'fill-opacity': 0.12,
      },
      filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
    }, beforeId);
    addLayerSafe(map, {
      id: 'country-highlight-border',
      type: 'line',
      source: 'country-boundaries',
      paint: {
        'line-color': '#3b82f6',
        'line-opacity': 0.5,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.05, 4, 1.5, 6, 1.9],
      },
      filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
    }, beforeId);
    addSourceSafe(map, 'wc-host-countries', hostCountriesGeoJson());
    addLayerSafe(map, {
      id: 'wc-host-country-fill',
      type: 'fill',
      source: 'wc-host-countries',
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': 0.018,
      },
    }, beforeId);
    addLayerSafe(map, {
      id: 'wc-host-country-border',
      type: 'line',
      source: 'wc-host-countries',
      paint: {
        'line-color': '#ffffff',
        'line-opacity': 0.12,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 4, 1.15, 6, 1.45],
      },
    }, beforeId);

    const [usTopology, canada, mexico] = await Promise.all([
      fetch(LOCAL_US_STATES_TOPOJSON_URL).then((response) => response.json()),
      fetch(LOCAL_CANADA_PROVINCES_GEOJSON_URL).then((response) => response.json()),
      fetch(LOCAL_MEXICO_STATES_GEOJSON_URL).then((response) => response.json()),
    ]);
    if (!map.getStyle()) return;
    addSourceSafe(map, 'wc-us-states', feature(usTopology, usTopology.objects.states) as any);
    addSourceSafe(map, 'wc-canada-provinces', canada);
    addSourceSafe(map, 'wc-mexico-states', mexico);
    const adminPaint = {
      'line-color': '#c5c9c9',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.22, 3.5, 0.38, 6, 0.56],
      'line-dasharray': [3, 2],
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.64, 4, 0.9, 6, 1.18],
    };
    addLayerSafe(map, { id: 'wc-us-state-lines', type: 'line', source: 'wc-us-states', paint: adminPaint }, beforeId);
    addLayerSafe(map, { id: 'wc-canada-province-lines', type: 'line', source: 'wc-canada-provinces', paint: adminPaint }, beforeId);
    addLayerSafe(map, { id: 'wc-mexico-state-lines', type: 'line', source: 'wc-mexico-states', paint: adminPaint }, beforeId);
    setupCountryHover(map, setRegionHover);
  } finally {
    (map as any).__worldCupSupportLayersLoading = false;
  }
}

function compactCityName(city: string) {
  return city.replace(' / ', '/').replace(' Bay Area', '').replace(' Gardens', '');
}

function cityStatus(cityId: string, matches: WorldCupMatch[]) {
  const cityMatches = matches.filter((match) => match.cityId === cityId);
  if (cityMatches.some((match) => match.status === 'live')) return 'LIVE';
  if (cityMatches.some((match) => match.status === 'scheduled')) return 'UPCOMING';
  return 'FINISHED';
}

function matchTitle(match: WorldCupMatch) {
  return `${match.homeTeam} vs ${match.awayTeam}`;
}

function shortKickoff(match: WorldCupMatch) {
  return match.kickoffLocal.replace(',', ' ·');
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function weatherRiskScore(weather: WorldCupCityWeather | null) {
  if (!weather) return 0;
  const precip = weather.current.precipitationProbability || 0;
  const wind = weather.current.windKph || 0;
  const storm = /storm|rain|watch|humid/i.test(weather.current.condition) ? 18 : 0;
  return Math.min(100, precip + storm + Math.max(0, wind - 14));
}

function offsetPoint(city: WorldCupVenueCity, index: number, radius = 0.33): [number, number] {
  const angle = (index * 137.5 * Math.PI) / 180;
  return [city.longitude + Math.cos(angle) * radius, city.latitude + Math.sin(angle) * radius * 0.72];
}

function buildCitySignals(
  cities: WorldCupVenueCity[],
  matches: WorldCupMatch[],
  weatherByCity: Map<string, WorldCupCityWeather>,
  nextMatch: WorldCupMatch | null,
  selectedCityId: string | null,
  selectedMatchId: string | null,
) {
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;
  const selectedFromMatch = selectedMatch?.cityId || null;
  return cities.map((city) => {
    const cityMatches = matches.filter((match) => match.cityId === city.id);
    const cityNextMatch = cityMatches.find((match) => match.id === nextMatch?.id)
      || cityMatches.find((match) => match.status === 'scheduled')
      || null;
    const weather = weatherByCity.get(city.id) || null;
    return {
      type: 'host-city',
      city,
      weather,
      matches: cityMatches,
      nextMatch: cityNextMatch,
      selected: city.id === selectedCityId || city.id === selectedFromMatch,
      next: city.id === nextMatch?.cityId,
      important: IMPORTANT_CITY_IDS.has(city.id),
      marketCount: cityMatches.filter((match) => match.marketLinked).length,
      oddsCount: cityMatches.filter((match) => match.oddsLinked).length,
      weatherRisk: weatherRiskScore(weather),
    } satisfies CitySignal;
  });
}

function buildDeckSignals(citySignals: CitySignal[], matches: WorldCupMatch[]) {
  const cityById = new Map(citySignals.map((signal) => [signal.city.id, signal.city]));
  const upcoming = matches.filter((match) => match.status !== 'finished').slice(0, 10);
  const schedulePaths: SchedulePath[] = [];
  for (let index = 1; index < upcoming.length; index += 1) {
    const previous = cityById.get(upcoming[index - 1]!.cityId);
    const current = cityById.get(upcoming[index]!.cityId);
    if (!previous || !current) continue;
    schedulePaths.push({
      type: 'schedule',
      id: `schedule-${upcoming[index]!.id}`,
      city: current,
      match: upcoming[index]!,
      path: [[previous.longitude, previous.latitude], [current.longitude, current.latitude]],
      selected: citySignals.find((signal) => signal.city.id === current.id)?.selected || false,
      next: index === 1,
    });
  }

  const weather: PointSignal[] = citySignals
    .filter((signal) => signal.weatherRisk >= 28)
    .map((signal, index) => {
      const [lon, lat] = offsetPoint(signal.city, index, 0.48);
      return {
        type: 'weather',
        id: `weather-${signal.city.id}`,
        city: signal.city,
        label: `${signal.weather?.current.condition || 'Weather risk'}`,
        sublabel: `${signal.weatherRisk.toFixed(0)} risk`,
        lon,
        lat,
        weight: signal.weatherRisk,
      };
    });

  const markets: PointSignal[] = citySignals
    .filter((signal) => signal.marketCount > 0)
    .map((signal, index) => {
      const [lon, lat] = offsetPoint(signal.city, index + 2, 0.42);
      return {
        type: 'market',
        id: `market-${signal.city.id}`,
        city: signal.city,
        label: 'Polymarket markets',
        sublabel: `${signal.marketCount} linked`,
        lon,
        lat,
        weight: signal.marketCount,
      };
    });

  const odds: PointSignal[] = citySignals
    .filter((signal) => signal.oddsCount > 0)
    .map((signal, index) => {
      const [lon, lat] = offsetPoint(signal.city, index + 4, 0.35);
      return {
        type: 'odds',
        id: `odds-${signal.city.id}`,
        city: signal.city,
        label: 'Sportsbook odds',
        sublabel: `${signal.oddsCount} snapshots`,
        lon,
        lat,
        weight: signal.oddsCount,
      };
    });

  const transit: PointSignal[] = citySignals.map((signal, index) => {
    const [lon, lat] = offsetPoint(signal.city, index + 7, 0.26);
    return {
      type: 'transit',
      id: `transit-${signal.city.id}`,
      city: signal.city,
      label: 'Airport / transit',
      sublabel: signal.city.country,
      lon,
      lat,
      weight: 1,
    };
  });

  const teams: PointSignal[] = citySignals.flatMap((signal, index) => {
    const match = signal.nextMatch;
    if (!match) return [];
    const home = offsetPoint(signal.city, index + 11, 0.22);
    const away = offsetPoint(signal.city, index + 13, 0.22);
    return [
      { type: 'team', id: `team-home-${match.id}`, city: signal.city, label: match.homeTeam, sublabel: 'team base', lon: home[0], lat: home[1], weight: 1 },
      { type: 'team', id: `team-away-${match.id}`, city: signal.city, label: match.awayTeam, sublabel: 'team base', lon: away[0], lat: away[1], weight: 1 },
    ] satisfies PointSignal[];
  });

  return { schedulePaths, weather, markets, odds, transit, teams };
}

function getActiveSignal(citySignals: CitySignal[], selectedCityId: string | null, selectedMatchId: string | null, matches: WorldCupMatch[], nextMatch: WorldCupMatch | null) {
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;
  return citySignals.find((signal) => signal.city.id === selectedCityId)
    || citySignals.find((signal) => signal.city.id === selectedMatch?.cityId)
    || citySignals.find((signal) => signal.city.id === nextMatch?.cityId)
    || citySignals[0]
    || null;
}

function buildDeckLayers(
  citySignals: CitySignal[],
  signals: ReturnType<typeof buildDeckSignals>,
  enabledLayers: EnabledLayers,
  zoom: number,
) {
  const layers = [];
  const showDenseLabels = zoom >= 3.35;

  if (enabledLayers.schedule) {
    layers.push(new PathLayer<SchedulePath>({
      id: 'wc-schedule-route-layer',
      data: signals.schedulePaths,
      getPath: (d) => d.path,
      getColor: (d) => (d.selected || d.next ? COLORS.next : [242, 184, 75, 30]),
      getWidth: (d) => (d.selected || d.next ? 1.6 : 0.72),
      widthMinPixels: 1,
      widthMaxPixels: 3,
      pickable: true,
    }));
  }

  if (enabledLayers.weather) {
    layers.push(new ScatterplotLayer<PointSignal>({
      id: 'wc-weather-risk-layer',
      data: signals.weather,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 16000 + d.weight * 500,
      getFillColor: COLORS.weather,
      getLineColor: [72, 210, 255, 92],
      lineWidthMinPixels: 0.5,
      radiusMinPixels: 5,
      radiusMaxPixels: 22,
      stroked: true,
      pickable: true,
    }));
  }

  if (enabledLayers.markets) {
    layers.push(new ScatterplotLayer<PointSignal>({
      id: 'wc-polymarket-layer',
      data: signals.markets,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 6500 + d.weight * 2400,
      getFillColor: COLORS.market,
      radiusMinPixels: 3,
      radiusMaxPixels: 8,
      pickable: true,
    }));
  }

  if (enabledLayers.odds) {
    layers.push(new ScatterplotLayer<PointSignal>({
      id: 'wc-odds-layer',
      data: signals.odds,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 6500 + d.weight * 2100,
      getFillColor: COLORS.odds,
      radiusMinPixels: 3,
      radiusMaxPixels: 9,
      pickable: true,
    }));
  }

  if (enabledLayers.transit) {
    layers.push(new ScatterplotLayer<PointSignal>({
      id: 'wc-transit-layer',
      data: signals.transit,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 7000,
      getFillColor: COLORS.transit,
      radiusMinPixels: 2,
      radiusMaxPixels: 6,
      pickable: true,
    }));
  }

  if (enabledLayers.teams) {
    layers.push(new ScatterplotLayer<PointSignal>({
      id: 'wc-team-base-layer',
      data: signals.teams,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6400,
      getFillColor: COLORS.team,
      radiusMinPixels: 2,
      radiusMaxPixels: 6,
      pickable: true,
    }));
  }

  if (enabledLayers.cities) {
    layers.push(new ScatterplotLayer<CitySignal>({
      id: 'wc-host-city-halo-layer',
      data: citySignals.filter((signal) => signal.selected || signal.next || signal.important),
      getPosition: (d) => [d.city.longitude, d.city.latitude],
      getRadius: (d) => d.selected ? 52000 : d.next ? 36000 : 26000,
      getFillColor: (d) => d.selected ? COLORS.selectedDim : d.next ? COLORS.nextDim : [255, 255, 255, 18],
      getLineColor: (d) => d.selected ? COLORS.selected : d.next ? COLORS.next : [255, 255, 255, 42],
      radiusMinPixels: 10,
      radiusMaxPixels: 30,
      lineWidthMinPixels: 1,
      stroked: true,
      pickable: false,
    }));
    layers.push(new ScatterplotLayer<CitySignal>({
      id: 'wc-host-city-layer',
      data: citySignals,
      getPosition: (d) => [d.city.longitude, d.city.latitude],
      getRadius: (d) => 9000 + Math.min(22000, (d.city.capacity || 50000) / 4),
      getFillColor: (d) => d.selected ? COLORS.selected : d.next ? COLORS.next : COLORS.city,
      getLineColor: COLORS.cityLine,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      lineWidthMinPixels: 1.5,
      stroked: true,
      pickable: true,
    }));
    layers.push(new TextLayer<CitySignal>({
      id: 'wc-host-city-label-layer',
      data: citySignals.filter((signal) => signal.selected || signal.next || signal.important || showDenseLabels),
      getPosition: (d) => [d.city.longitude, d.city.latitude],
      getText: (d) => `${compactCityName(d.city.city)}\n${cityStatus(d.city.id, d.matches)} - ${d.matches.length}`,
      getSize: (d) => d.selected || d.next ? 14 : 11,
      getColor: (d) => d.selected ? [255, 255, 255, 242] : [238, 241, 241, 216],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      getPixelOffset: [13, 5],
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontWeight: 900,
      lineHeight: 0.92,
      background: false,
      pickable: false,
    }));
  }

  return layers;
}

function getDeckTooltip(info: PickingInfo<DeckObject>) {
  if (!info.object) return null;
  const obj = info.object;
  if (obj.type === 'host-city') {
    return {
      html: `<div class="deckgl-tooltip"><strong>${escapeHtml(obj.city.city)}</strong><br/>${escapeHtml(obj.city.venue)}<br/>${obj.matches.length} matches · ${escapeHtml(obj.weather?.current.condition || 'weather seed')}</div>`,
    };
  }
  if (obj.type === 'schedule') {
    return {
      html: `<div class="deckgl-tooltip"><strong>${escapeHtml(matchTitle(obj.match))}</strong><br/>${escapeHtml(obj.city.city)} · ${escapeHtml(shortKickoff(obj.match))}</div>`,
    };
  }
  return {
    html: `<div class="deckgl-tooltip"><strong>${escapeHtml(obj.label)}</strong><br/>${escapeHtml(obj.city.city)} · ${escapeHtml(obj.sublabel)}</div>`,
  };
}

function LayerPanel({
  enabledLayers,
  onToggle,
}: {
  enabledLayers: EnabledLayers;
  onToggle: (key: WorldCupLayerKey) => void;
}) {
  const layers: Array<[WorldCupLayerKey, string, string, string]> = [
    ['cities', '●', 'HOST CITIES', '16'],
    ['schedule', '⚽', 'MATCH SCHEDULE', 'LIVE'],
    ['weather', '☁', 'WEATHER RISK', 'FORECAST'],
    ['markets', '$', 'POLYMARKET MARKETS', 'LOCAL DB'],
    ['odds', '◒', 'SPORTSBOOK ODDS', 'WATCH'],
    ['transit', '⌁', 'AIRPORT / TRANSIT', 'SEED'],
    ['teams', '◆', 'TEAM BASES', 'PENDING'],
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
        {layers.map(([key, icon, label, status]) => (
          <button
            type="button"
            className={`wm-worldcup-map-layer-row ${enabledLayers[key] ? 'active' : ''}`}
            key={key}
            onClick={() => onToggle(key)}
          >
            <i>{enabledLayers[key] ? '✓' : ''}</i>
            <b>{icon}</b>
            <span>{label}</span>
            <em>{status}</em>
          </button>
        ))}
      </div>
      <footer>World Cup Atlas · MapLibre/deck.gl</footer>
    </aside>
  );
}

function MapControls({ map }: { map: MapLibreMap | null }) {
  return (
    <div className="wm-worldcup-map-controls">
      <button type="button" onClick={() => map?.zoomIn()} aria-label="Zoom in">+</button>
      <button type="button" onClick={() => map?.zoomOut()} aria-label="Zoom out">−</button>
      <button type="button" onClick={() => map?.easeTo({ center: WORLDCUP_ATLAS_CENTER, zoom: WORLDCUP_ATLAS_ZOOM, pitch: 0, bearing: 0 })} aria-label="Reset view">⌂</button>
    </div>
  );
}

export function WorldCupMap({ cities, matches, weather, nextMatch, selectedCityId, selectedMatchId, onSelectCity }: WorldCupMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const styleTimeoutRef = useRef<number | null>(null);
  const fallbackAppliedRef = useRef(false);
  const dataRef = useRef({ cities, matches, weather, nextMatch, selectedCityId, selectedMatchId });
  const enabledLayersRef = useRef(DEFAULT_ENABLED_LAYERS);
  const [enabledLayers, setEnabledLayers] = useState<EnabledLayers>(DEFAULT_ENABLED_LAYERS);
  const [mapReady, setMapReady] = useState(false);
  const [mapDegraded, setMapDegraded] = useState(false);
  const [regionHover, setRegionHover] = useState<MapRegionHover | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const weatherByCity = useMemo(() => {
    const index = new Map<string, WorldCupCityWeather>();
    weather.forEach((item) => index.set(item.cityId, item));
    return index;
  }, [weather]);

  const citySignals = useMemo(
    () => buildCitySignals(cities, matches, weatherByCity, nextMatch, selectedCityId, selectedMatchId),
    [cities, matches, nextMatch, selectedCityId, selectedMatchId, weatherByCity],
  );
  const activeSignal = getActiveSignal(citySignals, selectedCityId, selectedMatchId, matches, nextMatch);
  const activeMatches = activeSignal?.matches || [];
  const nextCityMatch = activeSignal?.nextMatch || null;

  const updateDeckLayers = () => {
    const map = mapRef.current;
    const overlay = deckOverlayRef.current;
    if (!map || !overlay) return;
    const current = dataRef.current;
    const weatherIndex = new Map<string, WorldCupCityWeather>();
    current.weather.forEach((item) => weatherIndex.set(item.cityId, item));
    const currentCitySignals = buildCitySignals(
      current.cities,
      current.matches,
      weatherIndex,
      current.nextMatch,
      current.selectedCityId,
      current.selectedMatchId,
    );
    overlay.setProps({
      layers: buildDeckLayers(currentCitySignals, buildDeckSignals(currentCitySignals, current.matches), enabledLayersRef.current, map.getZoom()),
    });
  };

  const highlightCountry = (iso2: string | null) => {
    const map = mapRef.current;
    if (!map) return;
    if (pulseRafRef.current) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = null;
    }
    const filter: any = ['==', ['get', 'ISO3166-1-Alpha-2'], iso2 || ''];
    try {
      if (map.getLayer('country-highlight-fill')) map.setFilter('country-highlight-fill', filter);
      if (map.getLayer('country-highlight-border')) map.setFilter('country-highlight-border', filter);
      if (!iso2 || !map.getLayer('country-highlight-fill')) return;
      const start = performance.now();
      const step = (now: number) => {
        if (!map.getLayer('country-highlight-fill')) {
          pulseRafRef.current = null;
          return;
        }
        const t = (now - start) / 3000;
        if (t >= 1) {
          map.setPaintProperty('country-highlight-fill', 'fill-opacity', 0.12);
          map.setPaintProperty('country-highlight-border', 'line-opacity', 0.5);
          pulseRafRef.current = null;
          return;
        }
        const pulse = Math.sin(t * Math.PI * 3) ** 2;
        const fade = 1 - t * t;
        map.setPaintProperty('country-highlight-fill', 'fill-opacity', 0.12 + 0.24 * pulse * fade);
        map.setPaintProperty('country-highlight-border', 'line-opacity', 0.5 + 0.44 * pulse * fade);
        pulseRafRef.current = requestAnimationFrame(step);
      };
      pulseRafRef.current = requestAnimationFrame(step);
    } catch {
      // Map style can be mid-switch during fallback.
    }
  };

  const toggleLayer = (key: WorldCupLayerKey) => {
    setEnabledLayers((current) => {
      const next = { ...current, [key]: !current[key] };
      enabledLayersRef.current = next;
      window.requestAnimationFrame(updateDeckLayers);
      return next;
    });
  };

  useEffect(() => {
    dataRef.current = { cities, matches, weather, nextMatch, selectedCityId, selectedMatchId };
    updateDeckLayers();
    const signal = getActiveSignal(
      buildCitySignals(cities, matches, weatherByCity, nextMatch, selectedCityId, selectedMatchId),
      selectedCityId,
      selectedMatchId,
      matches,
      nextMatch,
    );
    highlightCountry(signal?.city.country || null);
  }, [cities, matches, weather, nextMatch, selectedCityId, selectedMatchId, weatherByCity]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host || mapRef.current) return undefined;
    const map = new maplibregl.Map({
      container: host,
      style: primaryBasemapStyle(),
      center: WORLDCUP_ATLAS_CENTER,
      zoom: WORLDCUP_ATLAS_ZOOM,
      minZoom: 1.75,
      maxZoom: 7.6,
      renderWorldCopies: false,
      attributionControl: false,
      interactive: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      canvasContextAttributes: { powerPreference: 'high-performance' },
    });
    mapRef.current = map;

    const addDeck = () => {
      if (deckOverlayRef.current) return;
      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
        pickingRadius: 9,
        useDevicePixels: window.devicePixelRatio > 2 ? 2 : true,
        getTooltip: (info: PickingInfo<DeckObject>) => getDeckTooltip(info),
        onClick: (info: PickingInfo<DeckObject>) => {
          const object = info.object;
          const city = object?.type === 'host-city' ? object.city : object?.city;
          if (!city) return;
          onSelectCity(city.id);
          setInspectorOpen(true);
          map.easeTo({ center: [city.longitude, city.latitude], zoom: Math.max(map.getZoom(), 3.15), duration: 520 });
        },
        onError: (error: Error) => console.warn('[WorldCupMap] deck overlay render warning:', error.message),
      });
      deckOverlayRef.current = overlay;
      map.addControl(overlay as unknown as maplibregl.IControl);
      updateDeckLayers();
    };

    const loadSupport = () => {
      setMapReady(true);
      applyWorldMonitorMapPaint(map);
      loadMapSupportLayers(map, setRegionHover)
        .then(() => {
          highlightCountry(dataRef.current.selectedCityId
            ? dataRef.current.cities.find((city) => city.id === dataRef.current.selectedCityId)?.country || null
            : dataRef.current.nextMatch
              ? dataRef.current.cities.find((city) => city.id === dataRef.current.nextMatch?.cityId)?.country || null
              : null);
        })
        .catch(() => {});
      addDeck();
      updateDeckLayers();
    };

    const switchToLocalFallback = () => {
      if (fallbackAppliedRef.current) return;
      fallbackAppliedRef.current = true;
      setMapDegraded(true);
      if (pulseRafRef.current) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = null;
      }
      map.setStyle(buildLocalFallbackStyle(), { diff: false });
      map.once('style.load', loadSupport);
    };

    let tileLoadOk = false;
    let tileErrorCount = 0;
    const onError = (event: { error?: Error; message?: string }) => {
      const message = event.error?.message || event.message || '';
      if (/Failed to fetch|AJAXError|CORS|NetworkError|403|Forbidden|ERR_EMPTY_RESPONSE|Could not load style/i.test(message)) {
        tileErrorCount += 1;
        if (!tileLoadOk && tileErrorCount >= 2) switchToLocalFallback();
      }
    };
    const onData = (event: { dataType?: string }) => {
      if (event.dataType === 'source') {
        tileLoadOk = true;
        if (styleTimeoutRef.current) {
          window.clearTimeout(styleTimeoutRef.current);
          styleTimeoutRef.current = null;
        }
      }
    };

    map.on('load', loadSupport);
    map.on('style.load', loadSupport);
    map.on('idle', () => {
      setMapReady(true);
      updateDeckLayers();
    });
    map.on('move', updateDeckLayers);
    map.on('zoom', updateDeckLayers);
    map.on('resize', updateDeckLayers);
    map.on('error', onError);
    map.on('data', onData);

    styleTimeoutRef.current = window.setTimeout(() => {
      if (!tileLoadOk) switchToLocalFallback();
    }, 9000);

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        map.resize();
        updateDeckLayers();
      });
    });
    if (rootRef.current) resizeObserver.observe(rootRef.current);

    return () => {
      if (styleTimeoutRef.current) window.clearTimeout(styleTimeoutRef.current);
      if (pulseRafRef.current) cancelAnimationFrame(pulseRafRef.current);
      resizeObserver.disconnect();
      setRegionHover(null);
      deckOverlayRef.current?.finalize();
      deckOverlayRef.current = null;
      map.off('error', onError);
      map.off('data', onData);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div ref={rootRef} className={`wm-worldcup-map wm-worldcup-maplibre ${mapReady ? 'ready' : ''} ${mapDegraded ? 'degraded' : ''}`}>
      <div ref={mapHostRef} className="wm-worldcup-maplibre-host" />
      <LayerPanel enabledLayers={enabledLayers} onToggle={toggleLayer} />
      {regionHover ? (
        <div
          className="wm-worldcup-map-region-tooltip"
          style={{
            transform: `translate(${Math.round(regionHover.screenX - (rootRef.current?.getBoundingClientRect().left || 0) + 14)}px, ${Math.round(regionHover.screenY - (rootRef.current?.getBoundingClientRect().top || 0) + 14)}px)`,
          }}
        >
          <strong>{regionHover.region}</strong>
          <span>{regionHover.country}</span>
        </div>
      ) : null}
      {activeSignal ? (
        <aside className={`wm-worldcup-map-inspector ${inspectorOpen ? 'open' : 'collapsed'}`}>
          <div className="wm-worldcup-map-inspector-head">
            <span>SELECTED HOST CITY</span>
            <button type="button" onClick={() => setInspectorOpen((value) => !value)} aria-label="Toggle city inspector">
              {inspectorOpen ? '−' : '+'}
            </button>
          </div>
          <strong>{activeSignal.city.city}</strong>
          <em>{activeSignal.city.venue} · {activeSignal.city.countryName}</em>
          <div className="wm-worldcup-map-inspector-body">
            <div className="wm-worldcup-map-inspector-stats">
              <span><b>{activeSignal.matches.length}</b><small>MATCHES</small></span>
              <span><b>{activeSignal.city.capacity ? `${Math.round(activeSignal.city.capacity / 1000)}k` : '--'}</b><small>CAPACITY</small></span>
              <span><b>{activeSignal.weather ? `${activeSignal.weather.current.tempC}°` : '--'}</b><small>{activeSignal.weather?.current.condition || 'WEATHER'}</small></span>
              <span><b>{activeSignal.weather?.current.windKph || '--'}</b><small>WIND KPH</small></span>
            </div>
            {nextCityMatch ? (
              <section className="wm-worldcup-map-inspector-next">
                <span>NEXT MATCH</span>
                <strong>{matchTitle(nextCityMatch)}</strong>
                <em>#{nextCityMatch.fifaMatchNumber || '--'} · {shortKickoff(nextCityMatch)} · {nextCityMatch.status.toUpperCase()}</em>
              </section>
            ) : null}
            {activeSignal.weather ? (
              <section className="wm-worldcup-map-inspector-forecast">
                {activeSignal.weather.forecast.slice(0, 3).map((item) => (
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
          </div>
        </aside>
      ) : null}
      <MapControls map={mapRef.current} />
      <div className="wm-worldcup-maplibre-legend">
        <span>图例</span>
        <b className="admin" /> <em>行政区划</em>
        <b className="host" /> <em>主办城市</em>
        <b className="next" /> <em>下一场</em>
        <b className="weather" /> <em>天气</em>
        <b className="market" /> <em>市场</em>
      </div>
      <div className="wm-worldcup-maplibre-status">{mapDegraded ? 'LOCAL FALLBACK' : 'WEBGL'}</div>
    </div>
  );
}
