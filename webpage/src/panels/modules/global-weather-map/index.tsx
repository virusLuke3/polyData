import { Panel } from '@/components/Panel';
import { fetchRuntimeGlobalTemperatureMonitor } from '@/services/api';
import type { RuntimeGlobalWeatherCity, RuntimeGlobalWeatherMapPayload, RuntimeWeatherQuoteBin } from '@/types';
import { formatRelative } from '../../shared/formatters';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';

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

function num(value?: string | number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tempLabel(value?: string | number | null, unit?: string | null) {
  const parsed = num(value);
  if (parsed === null) return '--';
  return `${Math.round(parsed)}°${unit || ''}`;
}

function priceLabel(value?: string | number | null) {
  const parsed = num(value);
  if (parsed === null) return '--';
  return `${Math.round(parsed * 100)}%`;
}

function coverageRank(value?: string | null) {
  const parts = String(value || '').split('/').map((part) => Number(part));
  const quoted = parts[0] ?? NaN;
  const total = parts[1] ?? NaN;
  if (!Number.isFinite(quoted) || !Number.isFinite(total) || total <= 0) return 0;
  return quoted / total;
}

function citySortValue(city: RuntimeGlobalWeatherCity) {
  return num(city.forecastHigh ?? city.todayHigh ?? city.currentTemp) ?? -999;
}

function cityTone(city: RuntimeGlobalWeatherCity) {
  const high = num(city.forecastHigh ?? city.todayHigh ?? city.currentTemp);
  if (high === null) return 'neutral';
  if (String(city.unit || '').toUpperCase() === 'F') {
    if (high >= 90) return 'hot';
    if (high <= 45) return 'cool';
  } else {
    if (high >= 32) return 'hot';
    if (high <= 7) return 'cool';
  }
  return 'neutral';
}

function eventStatus(city: RuntimeGlobalWeatherCity) {
  const status = String(city.eventStatus || '').toLowerCase();
  if (!city.eventSlug) return '--';
  if (status === 'closed' || status === 'resolved') return 'Event Closed';
  return 'Live';
}

function bestBin(city: RuntimeGlobalWeatherCity): RuntimeWeatherQuoteBin | null {
  if (city.topBin) return city.topBin;
  const bins = city.bins || [];
  let best: RuntimeWeatherQuoteBin | null = null;
  for (const bin of bins) {
    if ((num(bin.midPriceYes) ?? -1) > (num(best?.midPriceYes) ?? -1)) best = bin;
  }
  return best;
}

function quoteCoverage(city: RuntimeGlobalWeatherCity) {
  const coverage = city.quoteCoverage || (city.bins?.length ? `${city.bins.filter((bin) => num(bin.midPriceYes) !== null).length}/${city.bins.length}` : '0/0');
  return coverage;
}

function MiniSpark({ city }: { city: RuntimeGlobalWeatherCity }) {
  const hourly = (city.hourly || []).filter((point) => num(point.temp) !== null).slice(0, 12);
  const points = hourly.length >= 2 ? hourly : (city.bins || []).filter((bin) => num(bin.midPriceYes) !== null).slice(0, 12).map((bin, index) => ({ time: String(index), temp: num(bin.midPriceYes)! * 100 }));
  if (points.length < 2) return <span className="wm-weather-table-mini-empty">--</span>;
  const values = points.map((point) => num(point.temp) ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const polyline = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 112;
    const y = 28 - ((value - min) / range) * 24;
    return `${x.toFixed(1)},${Math.max(2, Math.min(28, y)).toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="wm-weather-table-mini" viewBox="0 0 112 30" aria-hidden="true">
      <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 112;
        const y = 28 - ((value - min) / range) * 24;
        return <circle key={`${city.cityId}-mini-${index}`} cx={x} cy={Math.max(2, Math.min(28, y))} r="1.8" />;
      })}
    </svg>
  );
}

function TemperatureRow({ city }: { city: RuntimeGlobalWeatherCity }) {
  const top = bestBin(city);
  const unit = city.unit || top?.unit || '';
  const event = eventStatus(city);
  return (
    <tr className={cityTone(city)}>
      <td><button className="wm-weather-table-icon" type="button" aria-label={`Watch ${city.city || 'city'}`}>+</button></td>
      <td>{city.marketUrl ? <a className="wm-weather-table-open" href={city.marketUrl} target="_blank" rel="noreferrer">OPEN</a> : <span className="wm-weather-table-open muted">--</span>}</td>
      <td><strong>{city.city || '--'}</strong></td>
      <td><MiniSpark city={city} /></td>
      <td>{city.condition || '--'}</td>
      <td>{tempLabel(city.todayLow ?? city.daily?.[0]?.low, unit)} or below</td>
      <td>{tempLabel(city.todayHigh ?? city.daily?.[0]?.high, unit)}</td>
      <td>{tempLabel(city.forecastHigh ?? city.todayHigh, unit)}</td>
      <td>{top?.label || '--'}</td>
      <td><span className={event === 'Live' ? 'wm-weather-live' : 'wm-weather-closed'}>{event}</span></td>
      <td>{quoteCoverage(city)}</td>
      <td>{formatRelative(city.updatedAt || city.hourly?.[0]?.time || null)}</td>
      <td>{priceLabel(top?.midPriceYes)}</td>
    </tr>
  );
}

function TemperatureMonitorPanel({ payload }: { payload?: RuntimeGlobalWeatherMapPayload | null }) {
  const items = [...(payload?.items || [])].sort((a, b) => {
    const coverageDelta = coverageRank(b.quoteCoverage) - coverageRank(a.quoteCoverage);
    if (Math.abs(coverageDelta) > 0.001) return coverageDelta;
    return citySortValue(b) - citySortValue(a);
  });
  const summary = payload?.summary;
  return (
    <Panel
      title="GLOBAL TEMP MONITOR"
      badge={statusBadge(payload?.status)}
      status={panelStatus(payload?.status)}
      count={`${summary?.mappedCount ?? items.length}/${summary?.cityCount ?? items.length}`}
      className="wm-market-panel wm-global-temperature-monitor-panel"
      dataPanelId="global-temperature-monitor"
    >
      <div className="wm-weather-table-meta">
        <span>Selected date: {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '--'}</span>
        <span>Last snapshot: {formatRelative(payload?.generatedAt)}</span>
        <span>Sources: {Object.entries(payload?.sources || {}).map(([key, value]) => `${key}=${value}`).join(' / ') || '--'}</span>
      </div>
      <div className="wm-weather-table-shell">
        <table className="wm-weather-table">
          <thead>
            <tr>
              <th>WL</th>
              <th>PM</th>
              <th>City</th>
              <th>Mini</th>
              <th>Condition</th>
              <th>Lowest</th>
              <th>Peak</th>
              <th>WU High Forecast</th>
              <th>Highest</th>
              <th>Event Status</th>
              <th>Quote Coverage</th>
              <th>Last Updated</th>
              <th>Top Yes</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((city) => <TemperatureRow key={String(city.cityId || city.city)} city={city} />) : (
              <tr>
                <td colSpan={13} className="wm-weather-table-empty">Weather seed warming. The map will return stale or seed data while the background builder runs.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'global-temperature-monitor': {
    size: 'wide',
    render: (ctx) => <TemperatureMonitorPanel payload={ctx.runtimeData['global-temperature-monitor'] as RuntimeGlobalWeatherMapPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'global-temperature-monitor',
  title: 'Global Temp Monitor',
  eyebrow: 'weather',
  description: 'Live global city temperatures, forecast highs, and Polymarket quote coverage in a monitor table.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  fetchData: () => fetchRuntimeGlobalTemperatureMonitor(34),
});
