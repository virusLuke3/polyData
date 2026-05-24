import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import { geoEquirectangular, geoGraticule, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-110m.json';
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

const FALLBACK_W = 1200;
const FALLBACK_H = 620;

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

function compactPriceSource(value: string | null) {
  if (value === 'clob-book') return 'CLOB';
  if (value === 'db-latest') return 'LAST';
  if (value === 'gamma-outcome') return 'GAMMA';
  return 'MISS';
}

function compactBookStatus(value: string | null) {
  if (!value) return '--';
  if (value === 'no-book') return 'NO BOOK';
  if (value === 'missing-token') return 'NO TOKEN';
  return value.toUpperCase();
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

function pointFillColor(point: WeatherMapPoint): [number, number, number, number] {
  if (point.temperatureTone === 'hot') return [255, 121, 72, 220];
  if (point.temperatureTone === 'cool') return [72, 215, 190, 210];
  return [255, 166, 32, 215];
}

function pointLineColor(point: WeatherMapPoint, selectedCityId?: string | null): [number, number, number, number] {
  if (point.id === selectedCityId) return [255, 245, 190, 255];
  if (point.temperatureTone === 'hot') return [255, 190, 120, 245];
  if (point.temperatureTone === 'cool') return [128, 234, 220, 235];
  return [255, 255, 255, 85];
}

function labelColor(point: WeatherMapPoint, selectedCityId?: string | null): [number, number, number, number] {
  if (point.id === selectedCityId) return [255, 243, 190, 255];
  if (point.topBinLabel) return [115, 216, 255, 255];
  return [230, 235, 230, 230];
}

function shouldShowLabel(point: WeatherMapPoint, selectedCityId?: string | null) {
  return point.id === selectedCityId
    || point.forecastHigh != null
    || point.currentTemp != null
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
  const bidAsk = point.topBinBid != null || point.topBinAsk != null
    ? ` · bid ${probabilityLabel(point.topBinBid)} / ask ${probabilityLabel(point.topBinAsk)}`
    : '';
  return `
    <div class="wm-weather-deck-tooltip">
      <strong>${escapeHtml(point.city)}</strong>
      <br>${escapeHtml(point.condition)} · ${escapeHtml(temp)}
      <br>PMKT ${escapeHtml(point.topBinLabel || 'No event')} · ${escapeHtml(point.quoteCoverage)} · ${escapeHtml(price)}${escapeHtml(bidAsk)}
      <br>${escapeHtml(compactPriceSource(point.priceSource))} · ${escapeHtml(compactBookStatus(point.bookStatus))}
    </div>
  `;
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
    <div className="wm-weather-html-label-layer" aria-hidden="true">
      {points.filter((point) => point.visible && shouldShowLabel(point, selectedCityId)).map((point) => (
        <button
          type="button"
          key={`weather-label-${point.id}`}
          className={`wm-weather-html-label ${point.temperatureTone} ${point.marketTone} ${point.id === selectedCityId ? 'selected' : ''}`}
          style={{
            transform: `translate(${Math.round(point.x + point.labelDx)}px, ${Math.round(point.y + point.labelDy)}px)`,
          }}
          onClick={() => onSelectCity?.(point.id)}
        >
          <strong>{point.city}</strong>
          <span>{point.sublabel}</span>
        </button>
      ))}
    </div>
  );
}

function clampFallbackZoom(value: number) {
  return Math.max(1, Math.min(3.6, value));
}

function WeatherStaticFallback({ points, selectedCityId, onSelectCity }: { points: WeatherMapPoint[]; selectedCityId?: string | null; onSelectCity?: (cityId: string) => void }) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const { graticulePath, worldPath, projectedPoints } = useMemo(() => {
    const projection = geoEquirectangular();
    const world = feature(countriesAtlas as any, (countriesAtlas as any).objects.countries) as any;
    projection.fitExtent([[24, 20], [FALLBACK_W - 24, FALLBACK_H - 24]], world);
    const pathBuilder = geoPath(projection);
    const graticule = geoGraticule().step([30, 30])();
    return {
      graticulePath: pathBuilder(graticule) || '',
      worldPath: pathBuilder(world) || '',
      projectedPoints: points.flatMap((point) => {
        const projected = projection([point.lon, point.lat]);
        return projected ? [{ ...point, x: projected[0], y: projected[1] }] : [];
      }),
    };
  }, [points]);

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: false };
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const scaleX = FALLBACK_W / Math.max(1, rect.width);
    const scaleY = FALLBACK_H / Math.max(1, rect.height);
    const dx = (event.clientX - drag.lastX) * scaleX;
    const dy = (event.clientY - drag.lastY) * scaleY;
    if (Math.abs(dx) + Math.abs(dy) > 1.5) drag.moved = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const endPointerDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const svg = event.currentTarget as SVGSVGElement;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * FALLBACK_W;
    const svgY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * FALLBACK_H;
    const zoomDelta = event.deltaY < 0 ? 1.16 : 0.86;
    setView((current) => {
      const nextZoom = clampFallbackZoom(current.zoom * zoomDelta);
      const baseX = (svgX - current.x) / current.zoom;
      const baseY = (svgY - current.y) / current.zoom;
      return {
        zoom: nextZoom,
        x: svgX - baseX * nextZoom,
        y: svgY - baseY * nextZoom,
      };
    });
  };

  return (
    <div className="wm-weather-static-fallback" data-weather-map-fallback="true">
      <svg
        viewBox={`0 0 ${FALLBACK_W} ${FALLBACK_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
        onWheel={handleWheel}
      >
        <defs>
          <radialGradient id="weatherFallbackSea" cx="50%" cy="46%" r="70%">
            <stop offset="0%" stopColor="#101a1f" />
            <stop offset="100%" stopColor="#030405" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={FALLBACK_W} height={FALLBACK_H} fill="url(#weatherFallbackSea)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <path className="wm-weather-static-grid" d={graticulePath} />
          <path className="wm-weather-static-land" d={worldPath} />
          {projectedPoints.map((point) => {
            const selected = point.id === selectedCityId;
            const showLabel = shouldShowLabel(point, selectedCityId);
            return (
              <g key={`static-${point.id}`} className={`wm-weather-static-point ${point.temperatureTone} ${selected ? 'selected' : ''}`}>
                <circle className="ring" cx={point.x} cy={point.y} r={selected ? 11 : 8} />
                <circle
                  className="dot"
                  cx={point.x}
                  cy={point.y}
                  r={selected ? 5 : 4}
                  onClick={() => {
                    if (dragRef.current?.moved) return;
                    onSelectCity?.(point.id);
                  }}
                />
                {showLabel ? (
                  <g
                    className="label-hit"
                    transform={`translate(${point.x + point.labelDx} ${point.y + point.labelDy})`}
                    onClick={() => {
                      if (dragRef.current?.moved) return;
                      onSelectCity?.(point.id);
                    }}
                  >
                    <rect x="-4" y="-13" width={Math.max(58, Math.max(point.city.length, point.sublabel.length) * 8)} height="27" rx="3" />
                    <text x="0" y="-2">{point.city}</text>
                    <text x="0" y="10" className="sub">{point.sublabel}</text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function WeatherDeckMap({ items, selectedCityId = null, onSelectCity, height = 320, interactive = true, showLabels = true }: WeatherDeckMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const onSelectRef = useRef(onSelectCity);
  const pointsRef = useRef<WeatherMapPoint[]>([]);
  const fallbackAppliedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [screenPoints, setScreenPoints] = useState<WeatherScreenPoint[]>([]);
  const points = useMemo(() => normalizePoints(items), [items]);
  const hasProjectedPoints = screenPoints.some((point) => point.visible);
  const showWebglLayer = mapReady && !mapFailed && hasProjectedPoints;

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
    setMapFailed(false);
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

    const overlay = new MapboxOverlay({
      interleaved: false,
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
      resizeAndSync();
    });

    map.on('idle', () => {
      setMapReady(true);
      resizeAndSync();
    });

    map.on('move', syncScreenPoints);
    map.on('zoom', syncScreenPoints);
    map.on('resize', syncScreenPoints);

    let tileErrorCount = 0;
    const initialFrame = window.requestAnimationFrame(resizeAndSync);
    const settleTimer = window.setTimeout(resizeAndSync, 250);
    const fallbackTimer = window.setTimeout(() => {
      if (!mapRef.current || fallbackAppliedRef.current) return;
      if (!map.loaded() || !projectScreenPoints(map, pointsRef.current).some((point) => point.visible)) {
        setMapFailed(true);
      }
    }, 4500);
    const onError = (event: { error?: Error; message?: string }) => {
      const message = event.error?.message || event.message || '';
      if (!message || fallbackAppliedRef.current) return;
      if (/Failed to fetch|AJAXError|CORS|NetworkError|403|Forbidden/i.test(message)) {
        tileErrorCount += 1;
        if (tileErrorCount >= 2) {
          fallbackAppliedRef.current = true;
          setMapFailed(true);
          map.setStyle(getWeatherMapFallbackStyle('dark'), { diff: false });
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
      window.clearTimeout(fallbackTimer);
      resizeObserver.disconnect();
      map.off('error', onError);
      map.off('move', syncScreenPoints);
      map.off('zoom', syncScreenPoints);
      map.off('resize', syncScreenPoints);
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
    setScreenPoints(projectScreenPoints(mapRef.current, points));
  }, [points, selectedCityId]);

  return (
    <div
      ref={rootRef}
      className={`wm-weather-deck-map ${showWebglLayer ? 'map-ready' : 'map-fallback'} ${hasProjectedPoints ? 'has-screen-points' : 'no-screen-points'}`}
      style={{ height: `${height}px` }}
    >
      <WeatherStaticFallback points={points} selectedCityId={selectedCityId} onSelectCity={onSelectCity} />
      <div ref={mapHostRef} className={`wm-weather-deck-basemap ${showWebglLayer ? 'ready' : ''}`} />
      {showLabels && showWebglLayer ? <WeatherHtmlLabels points={screenPoints} selectedCityId={selectedCityId} onSelectCity={onSelectCity} /> : null}
      <div className="wm-weather-deck-legend" aria-hidden="true">
        <span><i className="hot" />HOT</span>
        <span><i className="cool" />COOL</span>
      </div>
      <div className="wm-weather-deck-status">{showWebglLayer ? 'WebGL' : 'SVG'}</div>
    </div>
  );
}

export default WeatherDeckMap;
