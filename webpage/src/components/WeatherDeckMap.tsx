import { useEffect, useMemo, useRef } from 'preact/hooks';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { getWeatherMapFallbackStyle, getWeatherMapStyle } from '@/config/weatherBasemap';
import type { RuntimeGlobalWeatherCity } from '@/types';

type WeatherTone = 'hot' | 'cool' | 'neutral';
type MarketTone = 'market' | 'watch' | 'none';

type WeatherMapPoint = {
  id: string;
  city: string;
  lon: number;
  lat: number;
  unit: string;
  currentTemp: number | null;
  forecastHigh: number | null;
  condition: string;
  quoteCoverage: string;
  topBinLabel: string | null;
  topBinPrice: number | null;
  marketUrl: string | null;
  temperatureTone: WeatherTone;
  marketTone: MarketTone;
  label: string;
  sublabel: string;
  labelDx: number;
  labelDy: number;
};

type WeatherDeckMapProps = {
  items: RuntimeGlobalWeatherCity[];
  selectedCityId?: string | null;
  onSelectCity?: (cityId: string) => void;
  height?: number;
  interactive?: boolean;
};

const IMPORTANT_CITY_IDS = new Set([
  'new-york',
  'chicago',
  'dallas',
  'miami',
  'seattle',
  'london',
  'paris',
  'madrid',
  'tel-aviv',
  'ankara',
  'beijing',
  'shenzhen',
  'hong-kong',
  'singapore',
  'sydney',
]);

function numberValue(value?: string | number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function temperatureLabel(value: number | null, unit: string) {
  if (value == null) return '--';
  return `${Math.round(value)}°${unit || ''}`;
}

function probabilityLabel(value: number | null) {
  if (value == null) return '--';
  return `${Math.round(value * 100)}%`;
}

function temperatureTone(city: RuntimeGlobalWeatherCity): WeatherTone {
  const temp = numberValue(city.forecastHigh ?? city.currentTemp);
  if (temp == null) return 'neutral';
  if (String(city.unit || '').toUpperCase() === 'F') {
    if (temp >= 90) return 'hot';
    if (temp <= 45) return 'cool';
    return 'neutral';
  }
  if (temp >= 32) return 'hot';
  if (temp <= 7) return 'cool';
  return 'neutral';
}

function marketTone(city: RuntimeGlobalWeatherCity): MarketTone {
  if (!city.eventSlug) return 'none';
  const coverageParts = String(city.quoteCoverage || '').split('/').map((part) => Number(part));
  const quotedRaw = coverageParts[0];
  const totalRaw = coverageParts[1];
  const quoted = typeof quotedRaw === 'number' && Number.isFinite(quotedRaw) ? quotedRaw : 0;
  const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : 0;
  if (total > 0 && quoted / total >= 0.7) {
    return 'market';
  }
  return 'watch';
}

function pointFillColor(point: WeatherMapPoint): [number, number, number, number] {
  if (point.temperatureTone === 'hot') return [255, 121, 72, 220];
  if (point.temperatureTone === 'cool') return [72, 215, 190, 210];
  return [255, 166, 32, 215];
}

function pointLineColor(point: WeatherMapPoint, selectedCityId?: string | null): [number, number, number, number] {
  if (point.id === selectedCityId) return [255, 245, 190, 255];
  if (point.marketTone === 'market') return [255, 176, 35, 245];
  if (point.marketTone === 'watch') return [190, 154, 255, 225];
  return [255, 255, 255, 85];
}

function labelColor(point: WeatherMapPoint, selectedCityId?: string | null): [number, number, number, number] {
  if (point.id === selectedCityId) return [255, 243, 190, 255];
  if (point.topBinLabel) return [115, 216, 255, 255];
  return [230, 235, 230, 230];
}

function shouldShowLabel(point: WeatherMapPoint, selectedCityId?: string | null) {
  return point.id === selectedCityId
    || Boolean(point.topBinLabel)
    || point.temperatureTone === 'hot'
    || IMPORTANT_CITY_IDS.has(point.id);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function normalizePoints(items: RuntimeGlobalWeatherCity[]): WeatherMapPoint[] {
  return items.flatMap((city) => {
    const lat = numberValue(city.lat);
    const lon = numberValue(city.lon);
    const id = String(city.cityId || '').trim();
    if (!id || lat == null || lon == null) return [];
    const unit = String(city.unit || '').toUpperCase();
    const currentTemp = numberValue(city.currentTemp);
    const forecastHigh = numberValue(city.forecastHigh ?? city.todayHigh);
    const topBinPrice = numberValue(city.topBin?.midPriceYes);
    const topBinLabel = city.topBin?.label ? String(city.topBin.label) : null;
    const sublabel = topBinLabel || temperatureLabel(forecastHigh ?? currentTemp, unit);
    return [{
      id,
      city: String(city.city || id),
      lon,
      lat,
      unit,
      currentTemp,
      forecastHigh,
      condition: String(city.condition || 'Condition pending'),
      quoteCoverage: String(city.quoteCoverage || '0/0'),
      topBinLabel,
      topBinPrice,
      marketUrl: city.marketUrl ? String(city.marketUrl) : null,
      temperatureTone: temperatureTone(city),
      marketTone: marketTone(city),
      label: `${String(city.city || id)}\n${sublabel}`,
      sublabel,
      labelDx: numberValue(city.labelDx) ?? 8,
      labelDy: numberValue(city.labelDy) ?? -16,
    }];
  });
}

function buildLayers(points: WeatherMapPoint[], selectedCityId?: string | null) {
  const labelPoints = points.filter((point) => shouldShowLabel(point, selectedCityId));
  return [
    new ScatterplotLayer<WeatherMapPoint>({
      id: 'weather-city-points',
      data: points,
      getPosition: (point) => [point.lon, point.lat],
      getRadius: (point) => point.temperatureTone === 'hot' ? 42000 : 32000,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      getFillColor: pointFillColor,
      getLineColor: (point) => pointLineColor(point, selectedCityId),
      lineWidthMinPixels: 1,
      stroked: true,
      filled: true,
      pickable: true,
    }),
    new TextLayer<WeatherMapPoint>({
      id: 'weather-city-labels',
      data: labelPoints,
      getPosition: (point) => [point.lon, point.lat],
      getText: (point) => point.label,
      getSize: (point) => point.id === selectedCityId ? 12 : 10,
      getColor: (point) => labelColor(point, selectedCityId),
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      getPixelOffset: (point) => [point.labelDx, point.labelDy],
      fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, monospace',
      background: true,
      getBackgroundColor: (point) => point.id === selectedCityId ? [0, 0, 0, 230] : [0, 0, 0, 190],
      backgroundPadding: [5, 4],
      lineHeight: 1.05,
      pickable: true,
    }),
  ];
}

function tooltipFor(point: WeatherMapPoint) {
  const temp = temperatureLabel(point.forecastHigh ?? point.currentTemp, point.unit);
  const price = probabilityLabel(point.topBinPrice);
  return `
    <div class="wm-weather-deck-tooltip">
      <strong>${escapeHtml(point.city)}</strong>
      <br>${escapeHtml(point.condition)} · ${escapeHtml(temp)}
      <br>PMKT ${escapeHtml(point.topBinLabel || 'No event')} · ${escapeHtml(point.quoteCoverage)} · ${escapeHtml(price)}
    </div>
  `;
}

export function WeatherDeckMap({ items, selectedCityId = null, onSelectCity, height = 320, interactive = true }: WeatherDeckMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const onSelectRef = useRef(onSelectCity);
  const fallbackAppliedRef = useRef(false);
  const points = useMemo(() => normalizePoints(items), [items]);

  useEffect(() => {
    onSelectRef.current = onSelectCity;
  }, [onSelectCity]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host || mapRef.current) return undefined;
    const map = new maplibregl.Map({
      container: host,
      style: getWeatherMapStyle('dark'),
      center: [20, 24],
      zoom: 1.25,
      renderWorldCopies: false,
      attributionControl: false,
      interactive,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      canvasContextAttributes: { powerPreference: 'high-performance' },
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: buildLayers(points, selectedCityId),
      pickingRadius: 10,
      getTooltip: (info: PickingInfo<WeatherMapPoint>) => info.object ? { html: tooltipFor(info.object) } : null,
      onClick: (info: PickingInfo<WeatherMapPoint>) => {
        if (info.object?.id) onSelectRef.current?.(info.object.id);
      },
      onError: (error: Error) => {
        console.warn('[WeatherDeckMap] deck render error:', error.message);
      },
    });
    overlayRef.current = overlay;

    map.on('load', () => {
      map.addControl(overlay as unknown as maplibregl.IControl);
    });

    let tileErrorCount = 0;
    const onError = (event: { error?: Error; message?: string }) => {
      const message = event.error?.message || event.message || '';
      if (!message || fallbackAppliedRef.current) return;
      if (/Failed to fetch|AJAXError|CORS|NetworkError|403|Forbidden/i.test(message)) {
        tileErrorCount += 1;
        if (tileErrorCount >= 2) {
          fallbackAppliedRef.current = true;
          map.setStyle(getWeatherMapFallbackStyle('dark'), { diff: false });
        }
      }
    };
    map.on('error', onError);

    const resizeObserver = new ResizeObserver(() => map.resize());
    if (rootRef.current) resizeObserver.observe(rootRef.current);

    return () => {
      resizeObserver.disconnect();
      map.off('error', onError);
      overlay.finalize();
      overlayRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers: buildLayers(points, selectedCityId),
      getTooltip: (info: PickingInfo<WeatherMapPoint>) => info.object ? { html: tooltipFor(info.object) } : null,
      onClick: (info: PickingInfo<WeatherMapPoint>) => {
        if (info.object?.id) onSelectRef.current?.(info.object.id);
      },
    });
  }, [points, selectedCityId]);

  return (
    <div ref={rootRef} className="wm-weather-deck-map" style={{ height: `${height}px` }}>
      <div ref={mapHostRef} className="wm-weather-deck-basemap" />
      <div className="wm-weather-deck-legend" aria-hidden="true">
        <span><i className="hot" />HOT</span>
        <span><i className="cool" />COOL</span>
        <span><i className="market" />PMKT QUOTE</span>
      </div>
      <div className="wm-weather-deck-status">WebGL</div>
    </div>
  );
}

export default WeatherDeckMap;
