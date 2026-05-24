import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  topBinBid: number | null;
  topBinAsk: number | null;
  priceSource: string | null;
  bookStatus: string | null;
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
  showLabels?: boolean;
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

type WeatherScreenPoint = WeatherMapPoint & {
  x: number;
  y: number;
  visible: boolean;
};

function numberValue(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
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

function binTemperatureLabel(bin: RuntimeGlobalWeatherCity['topBin'], fallbackUnit: string) {
  if (!bin) return null;
  const unit = String(bin.unit || fallbackUnit || '').toUpperCase();
  const min = numberValue(bin.minTemp);
  const max = numberValue(bin.maxTemp);
  const minValue = numberValue(bin.minValue);
  const maxValue = numberValue(bin.maxValue);
  if (minValue != null || maxValue != null) {
    const suffix = unit ? unit.toLowerCase() : '';
    if (bin.bucketType === 'below' && maxValue != null) return `${Math.round(maxValue)}${suffix}-`;
    if (bin.bucketType === 'above' && minValue != null) return `${Math.round(minValue)}${suffix}+`;
    if (minValue != null && maxValue != null && minValue !== maxValue) return `${Math.round(minValue)}-${Math.round(maxValue)}${suffix}`;
    if (minValue != null) return `${Math.round(minValue)}${suffix}`;
    if (maxValue != null) return `${Math.round(maxValue)}${suffix}`;
  }
  if (bin.bucketType === 'below' && max != null) return `${Math.round(max)}°${unit}-`;
  if (bin.bucketType === 'above' && min != null) return `${Math.round(min)}°${unit}+`;
  if (min != null && max != null && min !== max) return `${Math.round(min)}-${Math.round(max)}°${unit}`;
  if (min != null) return `${Math.round(min)}°${unit}`;
  if (max != null) return `${Math.round(max)}°${unit}`;
  return null;
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

function shouldShowLabel(point: WeatherMapPoint, selectedCityId?: string | null) {
  return point.id === selectedCityId
    || point.forecastHigh != null
    || point.currentTemp != null
    || Boolean(point.topBinLabel)
    || point.temperatureTone === 'hot'
    || IMPORTANT_CITY_IDS.has(point.id);
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
    const topBinBid = numberValue(city.topBin?.bestBidYes);
    const topBinAsk = numberValue(city.topBin?.bestAskYes);
    const topBinLabel = city.topBin?.label ? String(city.topBin.label) : null;
    const topBinTemperature = binTemperatureLabel(city.topBin, unit);
    const weatherTemperature = temperatureLabel(forecastHigh ?? currentTemp, unit);
    const priceSuffix = topBinPrice != null ? ` · ${probabilityLabel(topBinPrice)}` : '';
    const sublabel = `${topBinTemperature || weatherTemperature}${priceSuffix}`;
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
      topBinBid,
      topBinAsk,
      priceSource: city.topBin?.priceSource ? String(city.topBin.priceSource) : null,
      bookStatus: city.topBin?.bookStatus ? String(city.topBin.bookStatus) : null,
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

function projectScreenPoints(map: MapLibreMap | null, points: WeatherMapPoint[]): WeatherScreenPoint[] {
  if (!map) return [];
  const canvas = map.getCanvas();
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  return points.map((point) => {
    const projected = map.project([point.lon, point.lat]);
    return {
      ...point,
      x: projected.x,
      y: projected.y,
      visible: projected.x > -90 && projected.x < width + 90 && projected.y > -60 && projected.y < height + 60,
    };
  });
}

function WeatherHtmlLabels({
  points,
  selectedCityId,
  onSelectCity,
}: {
  points: WeatherScreenPoint[];
  selectedCityId?: string | null;
  onSelectCity?: (cityId: string) => void;
}) {
  return (
    <div className="wm-weather-html-label-layer">
      {points.filter((point) => point.visible && shouldShowLabel(point, selectedCityId)).map((point) => (
        <button
          type="button"
          key={`weather-label-${point.id}`}
          className={`wm-weather-html-label ${point.temperatureTone} ${point.marketTone} ${point.id === selectedCityId ? 'selected' : ''}`}
          title={`${point.city} ${point.condition} ${point.sublabel}`}
          style={{
            transform: `translate(${Math.round(point.x + point.labelDx)}px, ${Math.round(point.y + point.labelDy)}px)`,
          }}
          onClick={() => onSelectCity?.(point.id)}
        >
          <i aria-hidden="true" />
          <strong>{point.city}</strong>
          <span>{point.sublabel}</span>
        </button>
      ))}
    </div>
  );
}

export function WeatherDeckMap({ items, selectedCityId = null, onSelectCity, height = 320, interactive = true, showLabels = true }: WeatherDeckMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelectCity);
  const pointsRef = useRef<WeatherMapPoint[]>([]);
  const fallbackAppliedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapDegraded, setMapDegraded] = useState(false);
  const [screenPoints, setScreenPoints] = useState<WeatherScreenPoint[]>([]);
  const points = useMemo(() => normalizePoints(items), [items]);
  const hasProjectedPoints = screenPoints.some((point) => point.visible);
  const showHtmlLayer = showLabels && hasProjectedPoints;

  useEffect(() => {
    onSelectRef.current = onSelectCity;
  }, [onSelectCity]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host || mapRef.current) return undefined;
    setMapReady(false);
    setMapDegraded(false);
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
    const syncScreenPoints = () => {
      setScreenPoints(projectScreenPoints(map, pointsRef.current));
    };
    const resizeAndSync = () => {
      if (!mapRef.current) return;
      map.resize();
      map.triggerRepaint();
      syncScreenPoints();
    };

    map.on('load', () => {
      setMapReady(true);
      resizeAndSync();
    });

    map.on('idle', () => {
      setMapReady(true);
      resizeAndSync();
    });

    map.on('styledata', resizeAndSync);
    map.on('move', syncScreenPoints);
    map.on('zoom', syncScreenPoints);
    map.on('resize', syncScreenPoints);

    let tileErrorCount = 0;
    const initialFrame = window.requestAnimationFrame(resizeAndSync);
    const settleTimer = window.setTimeout(resizeAndSync, 250);
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

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(resizeAndSync);
    });
    if (rootRef.current) resizeObserver.observe(rootRef.current);

    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.clearTimeout(settleTimer);
      resizeObserver.disconnect();
      map.off('error', onError);
      map.off('styledata', resizeAndSync);
      map.off('move', syncScreenPoints);
      map.off('zoom', syncScreenPoints);
      map.off('resize', syncScreenPoints);
      map.remove();
      mapRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    setScreenPoints(projectScreenPoints(mapRef.current, points));
  }, [points, selectedCityId]);

  return (
    <div
      ref={rootRef}
      className={`wm-weather-deck-map map-ready ${hasProjectedPoints ? 'has-screen-points' : 'no-screen-points'} ${mapDegraded ? 'map-degraded' : ''}`}
      style={{ height: `${height}px` }}
    >
      <div ref={mapHostRef} className={`wm-weather-deck-basemap ${mapReady || hasProjectedPoints ? 'ready' : ''}`} />
      {showHtmlLayer ? <WeatherHtmlLabels points={screenPoints} selectedCityId={selectedCityId} onSelectCity={onSelectCity} /> : null}
      <div className="wm-weather-deck-legend" aria-hidden="true">
        <span><i className="hot" />HOT</span>
        <span><i className="cool" />COOL</span>
      </div>
      <div className="wm-weather-deck-status">{mapDegraded ? 'Fallback tiles' : 'MapLibre'}</div>
    </div>
  );
}

export default WeatherDeckMap;
