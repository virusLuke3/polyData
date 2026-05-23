import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeDefiTokenWatch } from '@/services/api';
import type { RuntimeDefiTokenRow, RuntimeDefiTokenWatchPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { formatMoney, formatPercent, StatusDots, TinySparkline, toneFromValue } from '../market-monitor-kit';

function TokenRow({ item }: { item: RuntimeDefiTokenRow }) {
  const dayTone = toneFromValue(item.change24h);
  const weekTone = toneFromValue(item.change7d);
  return (
    <article className="wm-monitor-row wm-defi-token-row">
      <div className="wm-monitor-entity">
        <strong>{item.name || item.symbol || 'DeFi token'}</strong>
        <span>{item.symbol || '--'}</span>
      </div>
      <TinySparkline values={item.sparkline} tone={dayTone} />
      <div className="wm-monitor-values">
        <strong>{formatMoney(item.price)}</strong>
        <span className={`tone-${dayTone}`}>{formatPercent(item.change24h)}</span>
        <em className={`tone-${weekTone}`}>{formatPercent(item.change7d)}W</em>
      </div>
    </article>
  );
}

function sourceState(payload?: RuntimeDefiTokenWatchPayload | null) {
  const state = payload?.sources?.coingecko || payload?.status || '';
  if (/error|stale|invalid/i.test(String(state))) return 'STALE';
  if (/empty|warming/i.test(String(state))) return 'WARMING';
  return '';
}

function DefiTokenWatchPanel({ payload }: { payload?: RuntimeDefiTokenWatchPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const items = payload?.items || [];
  const badge = sourceState(payload);
  return (
    <Panel
      title="DEFI TOKENS"
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label="Explain DeFi token watch"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={badge || undefined}
      status={badge ? 'muted' : 'live'}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>DeFi Tokens</strong>
          <p>CoinGecko-backed DeFi token tape. Rows rank the configured DeFi watchlist with price, 24h move, and 7d move.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-monitor-panel wm-defi-token-panel"
      dataPanelId="defi-token-watch"
    >
      {items.length ? (
        <div className="wm-monitor-list">
          {items.map((item) => <TokenRow key={item.id || item.symbol || item.name} item={item} />)}
          <StatusDots />
        </div>
      ) : (
        <div className="wm-monitor-empty">
          <span>STANDBY</span>
          <strong>No DeFi token tape cached yet.</strong>
          <em>{payload?.cacheMode || payload?.status || 'warming'}</em>
        </div>
      )}
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'defi-token-watch': {
    render: (ctx) => <DefiTokenWatchPanel payload={ctx.runtimeData['defi-token-watch'] as RuntimeDefiTokenWatchPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'defi-token-watch',
  title: 'DeFi Token Watch',
  eyebrow: 'finance',
  description: 'Compact DeFi token tape with price, 24h move, and weekly trend.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 60000,
  fetchData: () => fetchRuntimeDefiTokenWatch(10),
});
