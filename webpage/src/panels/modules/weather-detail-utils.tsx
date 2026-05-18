import type { RuntimeGlobalWeatherCity, RuntimeGlobalWeatherMapPayload, RuntimeWeatherQuoteBin } from '@/types';
import { formatRelative } from '../shared/formatters';

export function num(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tempLabel(value?: string | number | null, unit?: string | null) {
  const parsed = num(value);
  if (parsed === null) return '--';
  return `${Math.round(parsed)}°${unit || ''}`;
}

export function currentWeatherTemp(city?: RuntimeGlobalWeatherCity | null) {
  return city?.currentTemp ?? city?.metarTemp ?? city?.todayHigh ?? null;
}

export function highWeatherTemp(city?: RuntimeGlobalWeatherCity | null) {
  return city?.forecastHigh ?? city?.todayHigh ?? city?.currentTemp ?? city?.metarTemp ?? null;
}

export function priceLabel(value?: string | number | null) {
  const parsed = num(value);
  if (parsed === null) return '--';
  return `${Math.round(parsed * 1000) / 10}%`;
}

export function selectedWeatherCity(payload?: RuntimeGlobalWeatherMapPayload | null, selectedCityId?: string | null) {
  const items = payload?.items || [];
  if (!items.length) return null;
  return items.find((item) => String(item.cityId || '') === String(selectedCityId || '')) || items[0] || null;
}

export function bestQuoteBin(city?: RuntimeGlobalWeatherCity | null): RuntimeWeatherQuoteBin | null {
  if (!city) return null;
  if (city.topBin) return city.topBin;
  let best: RuntimeWeatherQuoteBin | null = null;
  for (const bin of city.bins || []) {
    if ((num(bin.midPriceYes) ?? -1) > (num(best?.midPriceYes) ?? -1)) best = bin;
  }
  return best;
}

export function expectedQuoteBins(city?: RuntimeGlobalWeatherCity | null): RuntimeWeatherQuoteBin[] {
  if (!city) return [];
  const unit = city.unit || '';
  const anchor = num(city.forecastHigh ?? city.todayHigh ?? city.currentTemp ?? city.metarTemp);
  if (anchor === null) return [];
  const center = Math.round(anchor);
  const start = center - 5;
  return Array.from({ length: 11 }, (_, index) => {
    const value = start + index;
    const label = index === 0
      ? `${value}°${unit} or below`
      : index === 10
        ? `${value}°${unit} or higher`
        : `${value}°${unit}`;
    return {
      label,
      bucketType: index === 0 ? 'lte' : index === 10 ? 'gte' : 'eq',
      minTemp: value,
      maxTemp: value,
      unit,
      bestBidYes: null,
      bestAskYes: 0.001,
      midPriceYes: null,
      marketStatus: 'Missing Quote',
    };
  });
}

export function displayQuoteBins(city?: RuntimeGlobalWeatherCity | null): RuntimeWeatherQuoteBin[] {
  return city?.bins?.length ? city.bins : expectedQuoteBins(city);
}

export function quoteCoverage(city?: RuntimeGlobalWeatherCity | null) {
  if (!city) return '0/0';
  if (city.quoteCoverage) return city.quoteCoverage;
  const bins = city.bins || [];
  if (!bins.length) return '0/0';
  return `${bins.filter((bin) => num(bin.midPriceYes) !== null).length}/${bins.length}`;
}

export function statusBadge(status?: string | null) {
  const text = String(status || '').toLowerCase();
  if (text === 'ok') return 'LIVE';
  if (text === 'degraded') return 'PARTIAL';
  if (text === 'warming') return 'WARMING';
  return text ? text.toUpperCase() : 'SEED';
}

export function panelStatus(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

export function sourceStatus(city?: RuntimeGlobalWeatherCity | null) {
  const sourceStates = city?.sourceStates || {};
  const bad = Object.entries(sourceStates).find(([, value]) => !['ok', 'empty'].includes(String(value).toLowerCase()));
  if (bad) return `${bad[0]} ${bad[1]}`;
  if (sourceStates.polymarket === 'ok') return 'market linked';
  if (sourceStates.openMeteo === 'ok') return 'weather live';
  if (sourceStates.metar === 'ok') return 'metar live';
  return 'seed';
}

export function updatedLabel(city?: RuntimeGlobalWeatherCity | null, fallback?: string | null) {
  return formatRelative(city?.updatedAt || city?.hourly?.[0]?.time || fallback || null);
}

export function WeatherMiniLine({
  city,
  className = '',
  limit = 24,
}: {
  city?: RuntimeGlobalWeatherCity | null;
  className?: string;
  limit?: number;
}) {
  const points = (city?.hourly || []).filter((point) => num(point.temp) !== null).slice(0, limit);
  if (points.length < 2) return <div className={`wm-weather-detail-empty-line ${className}`.trim()}>No hourly curve</div>;
  const values = points.map((point) => num(point.temp) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const polyline = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 180;
    const y = 54 - ((value - min) / range) * 48;
    return `${x.toFixed(1)},${Math.max(4, Math.min(54, y)).toFixed(1)}`;
  }).join(' ');
  const lastValue = values[values.length - 1] ?? min;
  const lastY = Math.max(4, Math.min(54, 54 - ((lastValue - min) / range) * 48));
  return (
    <svg className={`wm-weather-detail-line ${className}`.trim()} viewBox="0 0 180 60" aria-hidden="true">
      <line x1="0" y1="54" x2="180" y2="54" />
      <line x1="0" y1="30" x2="180" y2="30" />
      <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="180" cy={lastY} r="3" />
    </svg>
  );
}
