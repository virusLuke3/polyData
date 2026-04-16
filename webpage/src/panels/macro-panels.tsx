import { Panel } from '@/components/Panel';
import type { PanelRenderContext } from '@/types';
import type { PanelRenderMap } from './types';
import { emptyState, marketTickerGrid, marketTickerList } from './shared/renderers';

function inflationNowcastPanel(ctx: PanelRenderContext) {
  const nowcast = ctx.inflationNowcast;
  if (!nowcast) return emptyState('No inflation nowcast loaded.');
  const mom = nowcast.monthOverMonth || {};
  const yoy = nowcast.yearOverYear || {};
  const monthlyLabel = mom['Month'] || yoy['Month'] || '--';
  return (
    <div className="wm-panel-stack">
      <section className="wm-nowcast-grid">
        {[
          { label: 'MONTH', value: monthlyLabel },
          { label: 'CPI MOM', value: mom['CPI'] || '--' },
          { label: 'CORE CPI', value: mom['Core CPI'] || '--' },
          { label: 'PCE MOM', value: mom['PCE'] || '--' },
          { label: 'CPI YOY', value: yoy['CPI'] || '--' },
          { label: 'CORE PCE', value: yoy['Core PCE'] || '--' },
        ].map((row) => (
          <article className="wm-nowcast-card" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </article>
        ))}
      </section>
      {!!nowcast.quarterly?.length && (
        <section className="wm-subpanel">
          <div className="wm-subpanel-title">QUARTERLY ANNUALIZED</div>
          <div className="wm-panel-list">
            {nowcast.quarterly.slice(0, 3).map((row, index) => (
              <article className="wm-oracle-card" key={`${row['Quarter'] || row['Quarter '] || row['Date'] || index}`}>
                <div className="wm-oracle-header">
                  <strong>{row['Quarter'] || row['Date'] || `Q${index + 1}`}</strong>
                  <span>{row['Updated'] || row['Updated '] || 'fed'}</span>
                </div>
                <div className="wm-summary-grid">
                  <div className="wm-summary-row"><span>CPI</span><strong>{row['CPI'] || '--'}</strong></div>
                  <div className="wm-summary-row"><span>CORE CPI</span><strong>{row['Core CPI'] || '--'}</strong></div>
                  <div className="wm-summary-row"><span>PCE</span><strong>{row['PCE'] || '--'}</strong></div>
                  <div className="wm-summary-row"><span>CORE PCE</span><strong>{row['Core PCE'] || '--'}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}


export const macroPanelRenderers: PanelRenderMap = {
  'commodities-watch': {
    size: 'wide',
    render: (ctx) => (
      <Panel title="COMMODITIES" badge="MACRO" status="live" count={ctx.commodities?.items.length || 0}>
        {marketTickerGrid(ctx.commodities?.items || [], 'No commodities loaded yet.')}
      </Panel>
    ),
  },
  'crypto-watch': {
    size: 'wide',
    render: (ctx) => (
      <Panel title="CRYPTO COMPLEX" badge="LIVE" status="live" count={ctx.crypto?.items.length || 0}>
        {marketTickerList(ctx.crypto?.items || [], 'No crypto prices loaded yet.')}
      </Panel>
    ),
  },
  'inflation-nowcast': {
    render: (ctx) => (
      <Panel title="INFLATION NOWCAST" badge="FED" status="live">
        {inflationNowcastPanel(ctx)}
      </Panel>
    ),
  },
};
