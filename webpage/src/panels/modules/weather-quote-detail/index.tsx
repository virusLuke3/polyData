import { Panel } from '@/components/Panel';
import type { RuntimeGlobalWeatherMapPayload, RuntimeWeatherQuoteBin } from '@/types';
import type { PanelRenderMap } from '../../types';
import { panelFromRenderer } from '../helpers';
import {
  bestQuoteBin,
  num,
  panelStatus,
  priceLabel,
  quoteCoverage,
  selectedWeatherCity,
  statusBadge,
  tempLabel,
} from '../weather-detail-utils';

function QuoteCurve({ bins }: { bins: RuntimeWeatherQuoteBin[] }) {
  const values = bins.map((bin) => num(bin.midPriceYes));
  const valid = values.filter((value): value is number => value !== null);
  if (bins.length < 2 || !valid.length) {
    return <div className="wm-weather-detail-empty-line">No quote curve</div>;
  }
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, bins.length - 1)) * 190;
    const y = value === null ? null : 58 - Math.max(0, Math.min(1, value)) * 52;
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
  return (
    <svg className="wm-weather-quote-curve" viewBox="0 0 190 64" aria-hidden="true">
      <line x1="0" y1="58" x2="190" y2="58" />
      <line x1="0" y1="32" x2="190" y2="32" />
      <line x1="0" y1="6" x2="190" y2="6" />
      {segments.map((segment, index) => (
        <polyline key={`quote-segment-${index}`} points={segment.join(' ')} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {points.map((point, index) => point.y === null ? null : (
        <circle key={`quote-dot-${index}`} cx={point.x} cy={point.y} r={point.value && point.value >= 0.99 ? 3.4 : 2.5} />
      ))}
    </svg>
  );
}

function QuoteRow({ bin, active }: { bin: RuntimeWeatherQuoteBin; active: boolean }) {
  const quoteState = num(bin.midPriceYes) === null ? 'missing' : 'quoted';
  return (
    <tr className={active ? 'active' : ''}>
      <td>{bin.label || tempLabel(bin.minTemp, bin.unit)}</td>
      <td>{priceLabel(bin.bestBidYes)}</td>
      <td>{priceLabel(bin.bestAskYes)}</td>
      <td>{priceLabel(bin.midPriceYes)}</td>
      <td><span className={`wm-weather-quote-state ${quoteState}`}>{quoteState}</span></td>
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
  const bins = city?.bins || [];
  const topBin = bestQuoteBin(city);
  const topLabel = topBin?.label || '--';
  return (
    <Panel
      title="WEATHER QUOTE DETAIL"
      badge={statusBadge(payload?.status)}
      status={panelStatus(payload?.status)}
      className="wm-market-panel wm-weather-quote-detail-panel"
      dataPanelId="weather-quote-detail"
    >
      {city ? (
        <div className="wm-weather-detail-stack">
          <section className="wm-weather-quote-head">
            <div>
              <span>{city.city || '--'}</span>
              <strong>{topLabel}</strong>
            </div>
            <b>{priceLabel(topBin?.midPriceYes)}</b>
          </section>
          <QuoteCurve bins={bins} />
          <div className="wm-weather-quote-meta">
            <span><i>Coverage</i><strong>{quoteCoverage(city)}</strong></span>
            <span><i>Bid</i><strong>{priceLabel(topBin?.bestBidYes)}</strong></span>
            <span><i>Ask</i><strong>{priceLabel(topBin?.bestAskYes)}</strong></span>
          </div>
          <div className="wm-weather-quote-table-wrap">
            <table className="wm-weather-quote-table">
              <thead>
                <tr>
                  <th>Bin</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>Mid</th>
                  <th>Quote</th>
                </tr>
              </thead>
              <tbody>
                {bins.length ? bins.map((bin) => (
                  <QuoteRow key={String(bin.marketSlug || bin.label)} bin={bin} active={String(bin.label || '') === String(topBin?.label || '')} />
                )) : (
                  <tr>
                    <td colSpan={5}>No quote bins for this city.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="wm-weather-detail-empty">Select a city to inspect quote bins.</div>
      )}
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'weather-quote-detail': {
    size: 'wide',
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
