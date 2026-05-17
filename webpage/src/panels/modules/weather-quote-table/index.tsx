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

function QuoteRow({ bin, active }: { bin: RuntimeWeatherQuoteBin; active: boolean }) {
  const quoteState = num(bin.midPriceYes) === null ? 'Missing Quote' : 'Quoted';
  return (
    <tr className={active ? 'active' : ''}>
      <td>{bin.label || tempLabel(bin.minTemp, bin.unit)}</td>
      <td>{priceLabel(bin.bestBidYes)}</td>
      <td>{priceLabel(bin.bestAskYes)}</td>
      <td>{priceLabel(bin.midPriceYes)}</td>
      <td><span className={`wm-weather-quote-state ${quoteState === 'Quoted' ? 'quoted' : 'missing'}`}>{quoteState}</span></td>
      <td>{bin.marketStatus || 'Closed'}</td>
    </tr>
  );
}

function WeatherQuoteTablePanel({
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
      title="WEATHER QUOTE TABLE"
      badge={statusBadge(payload?.status)}
      status={panelStatus(payload?.status)}
      className="wm-market-panel wm-weather-quote-table-only-panel"
      dataPanelId="weather-quote-table"
    >
      {city ? (
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
      ) : (
        <div className="wm-weather-detail-empty">Select a city to inspect quote bins.</div>
      )}
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'weather-quote-table': {
    size: 'wide',
    render: (ctx) => (
      <WeatherQuoteTablePanel
        payload={ctx.runtimeData['global-temperature-monitor'] as RuntimeGlobalWeatherMapPayload | undefined}
        selectedCityId={ctx.selectedWeatherCityId}
      />
    ),
  },
};

export const panel = panelFromRenderer(renderers, {
  id: 'weather-quote-table',
  title: 'Weather Quote Table',
  eyebrow: 'weather',
  description: 'Selected city temperature market quote bins in a compact table.',
  defaultEnabled: true,
});
