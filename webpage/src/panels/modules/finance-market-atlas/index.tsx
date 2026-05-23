import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceMarketAtlas } from '@/services/api';
import type { RuntimeFinanceLinkedMarket, RuntimeFinanceMarketAtlasCategory, RuntimeFinanceMarketAtlasPayload } from '@/types';
import type { PanelRenderMap } from '../../types';
import { runtimePanelFromRenderer } from '../helpers';
import { badgeLabel, dateLabel, financeTone, MiniBar, moneyLabel, MiniSparkline, panelTone, percentLabel, signedPercentLabel } from '../finance-common';

function sortItems(items: RuntimeFinanceLinkedMarket[]) {
  return [...items].sort((left, right) => {
    const rightScore = (Number(right.volume24h) || 0) + (Number(right.gapScore) || Math.abs(Number(right.change24h) || 0)) * 100000;
    const leftScore = (Number(left.volume24h) || 0) + (Number(left.gapScore) || Math.abs(Number(left.change24h) || 0)) * 100000;
    return rightScore - leftScore;
  });
}

function CategoryRow({ item }: { item: RuntimeFinanceMarketAtlasCategory }) {
  return (
    <div className="wm-finance-atlas-theme">
      <div>
        <strong>{item.label || item.id || 'Finance'}</strong>
        <span>{item.topTitle || 'Market flow'}</span>
      </div>
      <b>{moneyLabel(item.volume24h)}</b>
    </div>
  );
}

function MarketRow({ item }: { item: RuntimeFinanceLinkedMarket }) {
  const tone = financeTone(item.change24h);
  return (
    <div className={`wm-finance-atlas-row ${tone}`}>
      <MiniSparkline seed={`${item.marketId || item.title}-${item.change24h}`} tone={tone} bias={Number(item.change24h) >= 0 ? 0.35 : -0.35} />
      <div className="wm-finance-atlas-row-main">
        <span>{item.categoryLabel || item.category || 'Finance'} / {dateLabel(item.endDate)}</span>
        <strong>{item.title || 'Finance market'}</strong>
        <MiniBar value={Number(item.probability) * 100} tone={tone} />
      </div>
      <div className="wm-finance-atlas-row-value">
        <strong>{percentLabel(item.probability)}</strong>
        <span>{moneyLabel(item.volume24h)}</span>
        <em className={tone}>{signedPercentLabel(item.change24h)}</em>
      </div>
    </div>
  );
}

function FinanceMarketAtlasPanel({ payload }: { payload?: RuntimeFinanceMarketAtlasPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const items = sortItems(payload?.items || []);
  const top = payload?.summary?.topDislocation || items[0];
  return (
    <Panel
      title="FINANCE WATCH"
      titleControls={(
        <button type="button" className="wm-panel-help-button" aria-label="Explain finance atlas" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>?</button>
      )}
      badge={badgeLabel(payload?.status)}
      status={panelTone(payload?.status)}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>Finance Watch</strong>
          <p>Groups live finance prediction markets by theme, then surfaces the strongest price, liquidity, deadline, and 24h movement signals.</p>
        </div>
      ) : null}
      className="wm-market-panel wm-finance-panel wm-finance-atlas-panel"
      dataPanelId="finance-market-atlas"
    >
      {top ? (
        <div className="wm-finance-atlas-lead">
          <div className="wm-finance-atlas-lead-main">
            <span>{top.categoryLabel || top.category || payload?.summary?.topCategory || 'Market focus'}</span>
            <strong>{top.title || 'Finance market'}</strong>
            <MiniBar value={Number(top.probability) * 100} tone={financeTone(top.change24h)} />
          </div>
          <MiniSparkline seed={`${top.marketId || top.title}-lead`} tone={financeTone(top.change24h)} bias={Number(top.change24h) >= 0 ? 0.35 : -0.35} />
          <div className="wm-finance-atlas-lead-stats">
            <span><em>PRICE</em><b>{percentLabel(top.probability)}</b></span>
            <span><em>VALUE</em><b>{moneyLabel(top.volume24h)}</b></span>
            <span><em>24H</em><b className={financeTone(top.change24h)}>{signedPercentLabel(top.change24h)}</b></span>
          </div>
        </div>
      ) : null}
      <div className="wm-finance-atlas-themes">
        {(payload?.categories || []).slice(0, 5).map((category) => <CategoryRow key={category.id || category.label} item={category} />)}
      </div>
      <div className="wm-finance-atlas-list">
        {items.length ? items.map((item, index) => <MarketRow key={`${item.marketId || item.title || 'market'}-${index}`} item={item} />) : (
          <div className="wm-empty-state"><strong>Finance watch warming.</strong><em>No finance markets are cached yet.</em></div>
        )}
      </div>
    </Panel>
  );
}

const renderers: PanelRenderMap = {
  'finance-market-atlas': {
    render: (ctx) => <FinanceMarketAtlasPanel payload={ctx.runtimeData['finance-market-atlas'] as RuntimeFinanceMarketAtlasPayload | undefined} />,
  },
};

export const panel = runtimePanelFromRenderer(renderers, {
  id: 'finance-market-atlas',
  title: 'Finance Watch',
  eyebrow: 'finance',
  description: 'Live finance prediction markets grouped by theme with price, value, and movement context.',
  defaultEnabled: true,
}, {
  tier: 'slow',
  intervalMs: 60000,
  fetchData: () => fetchRuntimeFinanceMarketAtlas(16),
});
