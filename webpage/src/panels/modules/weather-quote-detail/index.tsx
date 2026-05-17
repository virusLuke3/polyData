import { Panel } from '@/components/Panel';
import type { RuntimeGlobalWeatherMapPayload, RuntimeWeatherQuoteBin } from '@/types';
import type { PanelRenderMap } from '../../types';
import { panelFromRenderer } from '../helpers';
import {
  bestQuoteBin,
  displayQuoteBins,
  num,
  panelStatus,
  priceLabel,
  quoteCoverage,
  selectedWeatherCity,
  statusBadge,
  tempLabel,
} from '../weather-detail-utils';

function QuoteCurve({ bins, cityName }: { bins: RuntimeWeatherQuoteBin[]; cityName?: string | null }) {
  const values = bins.map((bin) => num(bin.midPriceYes));
  const hasQuote = values.some((value) => value !== null);
  const points = values.map((value, index) => {
    const x = 42 + (index / Math.max(1, bins.length - 1)) * 276;
    const y = value === null ? null : 160 - Math.max(0, Math.min(1, value)) * 132;
    return { x, y, value };
  });
  const segments: string[][] = [];
  let current: string[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  if (current.length) segments.push(current);
  const labelIndexes = bins.map((_, index) => index).filter((index) => index === 0 || index === bins.length - 1 || index % 2 === 1);
  return (
    <div className="wm-weather-quote-curve-panel">
      <div className="wm-weather-chart-title">
        <strong>{cityName || 'Selected city'} Mid Price Curve</strong>
        <span>YES Mid %</span>
      </div>
      <svg className="wm-weather-quote-curve-large" viewBox="0 0 340 220" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = 160 - tick * 132;
          return (
            <g key={`y-${tick}`}>
              <line x1="42" y1={y} x2="318" y2={y} />
              <text x="36" y={y + 4} textAnchor="end">{Math.round(tick * 100)}%</text>
            </g>
          );
        })}
        <line x1="42" y1="28" x2="42" y2="160" />
        <line x1="42" y1="160" x2="318" y2="160" />
        {segments.map((segment, index) => (
          <polyline key={`quote-segment-${index}`} points={segment.join(' ')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {points.map((point, index) => point.y === null ? null : (
          <g key={`quote-dot-${index}`}>
            <circle cx={point.x} cy={point.y} r={point.value && point.value >= 0.99 ? 4.2 : 3.2} />
            {point.value && point.value >= 0.99 ? <text x={point.x + 6} y={point.y + 15}>{priceLabel(point.value)}</text> : null}
          </g>
        ))}
        {labelIndexes.map((index) => {
          const x = 42 + (index / Math.max(1, bins.length - 1)) * 276;
          return (
            <text className="wm-weather-quote-x-label" key={`x-${index}`} x={x} y="190" textAnchor="end" transform={`rotate(-44 ${x} 190)`}>
              {bins[index]?.label || ''}
            </text>
          );
        })}
      </svg>
      <div className="wm-weather-quote-history-strip">
        <button type="button">Play History</button>
        <span className="muted">24h ago</span>
        <span className="purple">12h ago</span>
        <span className="green">6h ago</span>
        <span className="cyan">1h ago</span>
        <span className="yellow">30m ago</span>
      </div>
      {!hasQuote ? <p>No matching Polymarket temperature market was found for this city. Expected bins are shown as missing quotes.</p> : null}
    </div>
  );
}

function QuoteRow({ bin, active }: { bin: RuntimeWeatherQuoteBin; active: boolean }) {
  const quoteState = num(bin.midPriceYes) === null ? 'Missing Quote' : 'Quoted';
  return (
    <tr className={active ? 'active' : ''}>
      <td>{bin.label || tempLabel(bin.minTemp, bin.unit)}</td>
      <td>{priceLabel(bin.bestBidYes)}</td>
      <td>{priceLabel(bin.bestAskYes)}</td>
      <td>{priceLabel(bin.midPriceYes)}</td>
      <td><span className={`wm-weather-quote-state ${quoteState === 'Quoted' ? 'quoted' : 'missing'}`}>{quoteState}</span></td>
      <td>{bin.marketStatus || '--'}</td>
    </tr>
  );
}

function WeatherQuoteDetailPanel({
  payload,
  selectedCityId,
}: {
  payload?: RuntimeGlobalWeatherMapPayload | null;
  selectedCityId?: string | null;
}) {
  const city = selectedWeatherCity(payload, selectedCityId);
  const bins = displayQuoteBins(city);
  const topBin = bestQuoteBin(city);
  const topLabel = topBin?.label || bins[Math.floor(bins.length / 2)]?.label || '--';
  return (
    <Panel
      title="WEATHER QUOTE DETAIL"
      badge={statusBadge(payload?.status)}
      status={panelStatus(payload?.status)}
      className="wm-market-panel wm-weather-quote-detail-panel"
      dataPanelId="weather-quote-detail"
    >
      {city ? (
        <div className="wm-weather-quote-workbench">
          <QuoteCurve bins={bins} cityName={city.city} />
          <section className="wm-weather-quote-table-panel">
            <div className="wm-weather-quote-table-head">
              <div>
                <span>{city.city || '--'} Quote Table</span>
                <strong>{topLabel}</strong>
              </div>
              <b>{priceLabel(topBin?.midPriceYes)}</b>
            </div>
            <div className="wm-weather-quote-meta">
              <span><i>Coverage</i><strong>{quoteCoverage(city)}</strong></span>
              <span><i>Best bid</i><strong>{priceLabel(topBin?.bestBidYes)}</strong></span>
              <span><i>Best ask</i><strong>{priceLabel(topBin?.bestAskYes)}</strong></span>
            </div>
            <div className="wm-weather-quote-table-wrap">
              <table className="wm-weather-quote-table">
                <thead>
                  <tr>
                    <th>Bin</th>
                    <th>Best Bid</th>
                    <th>Best Ask</th>
                    <th>Mid</th>
                    <th>Quote</th>
                    <th>Market</th>
                  </tr>
                </thead>
                <tbody>
                  {bins.map((bin) => (
                    <QuoteRow key={String(bin.marketSlug || bin.label)} bin={bin} active={String(bin.label || '') === String(topBin?.label || '')} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <div className="wm-weather-detail-empty">Select a city to inspect quote bins.</div>
      )}
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'weather-quote-detail': {
    size: 'large',
    render: (ctx) => (
      <WeatherQuoteDetailPanel
        payload={ctx.runtimeData['global-temperature-monitor'] as RuntimeGlobalWeatherMapPayload | undefined}
        selectedCityId={ctx.selectedWeatherCityId}
      />
    ),
  },
};

export const panel = panelFromRenderer(renderers, {
  id: 'weather-quote-detail',
  title: 'Weather Quote Detail',
  eyebrow: 'weather',
  description: 'Selected city Polymarket quote curve, best bin, and compact quote table.',
  defaultEnabled: true,
});
