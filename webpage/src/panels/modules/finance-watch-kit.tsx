import { useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchRuntimeFinanceWatchPanel } from '@/services/api';
import type { RuntimeFinanceWatchItem, RuntimeFinanceWatchPayload } from '@/types';
import { formatRelative } from '../shared/formatters';
import type { PanelRenderMap } from '../types';
import { runtimePanelFromRenderer } from './helpers';

type FinancePanelMode = 'rows' | 'feed' | 'grid' | 'sentiment' | 'etf';

type FinancePanelConfig = {
  id: string;
  title: string;
  description: string;
  question: string;
  mode?: FinancePanelMode;
  limit?: number;
};

function toneClass(value?: string | null) {
  const tone = String(value || 'neutral').toLowerCase();
  if (tone === 'up') return 'tone-up';
  if (tone === 'down') return 'tone-down';
  if (tone === 'watch') return 'tone-watch';
  return 'tone-neutral';
}

function statusBadge(payload?: RuntimeFinanceWatchPayload | null) {
  const status = String(payload?.status || '').toLowerCase();
  const cacheMode = String(payload?.cacheMode || '').toLowerCase();
  if (cacheMode.includes('stale')) return 'STALE';
  if (status === 'ok') return 'LIVE';
  if (status === 'degraded' || status === 'partial') return 'PARTIAL';
  if (status === 'empty') return 'WARMING';
  return status ? status.toUpperCase() : 'SEED';
}

function itemKey(item: RuntimeFinanceWatchItem, index: number) {
  return String(item.id || item.url || item.title || item.label || index);
}

function FinanceTags({ tags }: { tags?: string[] }) {
  return (
    <>
      {(tags || []).slice(0, 3).map((tag) => <span className={`wm-finance-tag tag-${String(tag).toLowerCase().replace(/\W+/g, '-')}`} key={tag}>{tag}</span>)}
    </>
  );
}

function ValueBlock({ item }: { item: RuntimeFinanceWatchItem }) {
  return (
    <div className="wm-finance-value">
      <strong>{item.metricLabel || '--'}</strong>
      {item.changeLabel ? <em className={toneClass(item.tone)}>{item.changeLabel}</em> : null}
      {!item.changeLabel && item.secondaryLabel ? <em>{item.secondaryLabel}</em> : null}
    </div>
  );
}

function QuoteRow({ item }: { item: RuntimeFinanceWatchItem }) {
  return (
    <article className="wm-finance-row">
      <div className="wm-finance-main">
        <strong>{item.label || item.title || 'Finance item'}</strong>
        <span>{item.symbol || item.metricUnit || '--'}</span>
      </div>
      <ValueBlock item={item} />
      <div className="wm-finance-row-foot">
        <FinanceTags tags={item.tags} />
        {item.secondaryLabel ? <span>{item.secondaryLabel}</span> : null}
      </div>
    </article>
  );
}

function FeedRow({ item }: { item: RuntimeFinanceWatchItem }) {
  const content = (
    <>
      <div className="wm-finance-feed-meta">
        <span className="wm-finance-dot" />
        <b>{item.label || item.source || 'SOURCE'}</b>
        <span>{item.source || item.symbol || 'RSS'}</span>
        <FinanceTags tags={item.tags} />
      </div>
      <strong>{item.title || item.label || 'Headline pending'}</strong>
      <em>{item.summary || item.title || 'Summary pending'}</em>
      <div className="wm-finance-feed-foot">
        <span>{formatRelative(item.publishedAt || undefined)}</span>
        {item.url ? <b>Read source</b> : null}
      </div>
    </>
  );
  if (item.url) {
    return <a className="wm-finance-feed-row" href={item.url} target="_blank" rel="noreferrer">{content}</a>;
  }
  return <article className="wm-finance-feed-row">{content}</article>;
}

function GridTile({ item }: { item: RuntimeFinanceWatchItem }) {
  return (
    <article className="wm-finance-grid-tile">
      <span>{item.symbol || item.metricUnit || '--'}</span>
      <strong>{item.label || '--'}</strong>
      <div>
        <b>{item.metricLabel || '--'}</b>
        <em className={toneClass(item.tone)}>{item.changeLabel || '--'}</em>
      </div>
    </article>
  );
}

function SentimentView({ payload }: { payload?: RuntimeFinanceWatchPayload | null }) {
  const headline = payload?.headline || {};
  const score = headline.score ?? '--';
  const delta = headline.delta;
  const deltaLabel = typeof delta === 'number' ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs prev` : null;
  const deltaTone = typeof delta === 'number' && delta >= 0 ? 'up' : 'down';
  const scoreNumber = Number(score);
  const angle = Number.isFinite(scoreNumber) ? Math.max(0, Math.min(100, scoreNumber)) * 1.8 - 90 : 0;
  return (
    <div className="wm-finance-sentiment">
      <section className={`wm-finance-sentiment-gauge ${toneClass(headline.tone)}`}>
        <b>{headline.regime || 'NEUTRAL'}</b>
        <div className="wm-finance-gauge-arc">
          <span className="zone z1" />
          <span className="zone z2" />
          <span className="zone z3" />
          <span className="zone z4" />
          <span className="zone z5" />
          <i style={{ transform: `rotate(${angle}deg)` }} />
          <strong>{score}</strong>
          <em>{headline.label || 'NEUTRAL'}</em>
        </div>
        {deltaLabel ? <small className={toneClass(deltaTone)}>{deltaLabel}</small> : null}
      </section>
      <div className="wm-finance-list compact">
        {(payload?.items || []).map((item, index) => <QuoteRow item={item} key={itemKey(item, index)} />)}
      </div>
    </div>
  );
}

function compactMoney(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '--';
  const sign = number < 0 ? '-' : '';
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function EtfView({ payload }: { payload?: RuntimeFinanceWatchPayload | null }) {
  const items = payload?.items || [];
  const summary = payload?.summary || {};
  const net = Number(summary.netFlowProxyUsd || 0);
  const dirClass = toneClass(net > 0 ? 'up' : net < 0 ? 'down' : 'neutral');
  return (
    <div className="wm-finance-etf">
      <div className="wm-finance-etf-summary">
        <span>NET FLOW<b className={dirClass}>{net > 0 ? 'INFLOW' : net < 0 ? 'OUTFLOW' : 'NEUTRAL'}</b></span>
        <span>EST FLOW<b>{compactMoney(summary.netFlowProxyUsd)}</b></span>
        <span>TOTAL VOL<b>{compactMoney(summary.totalVolume)}</b></span>
        <span>ETFS<b>{summary.inflowCount || 0}↑ {summary.outflowCount || 0}↓</b></span>
      </div>
      <div className="wm-finance-etf-table">
        <div className="wm-finance-etf-head">
          <span>CODE</span><span>ISSUER</span><span>EST FLOW</span><span>VOLUME</span><span>CHG</span>
        </div>
        {items.map((item, index) => (
          <article className="wm-finance-etf-row" key={itemKey(item, index)}>
            <b>{item.label}</b>
            <span>{item.symbol}</span>
            <em className={toneClass(item.tone)}>{item.metricLabel || '--'}</em>
            <span>{item.secondaryLabel || '--'}</span>
            <em className={toneClass(item.tone)}>{item.changeLabel || '--'}</em>
          </article>
        ))}
      </div>
    </div>
  );
}

function FinanceWatchView({ payload, mode }: { payload?: RuntimeFinanceWatchPayload | null; mode: FinancePanelMode }) {
  const items = payload?.items || [];
  if (mode === 'sentiment') return <SentimentView payload={payload} />;
  if (mode === 'etf') return <EtfView payload={payload} />;
  if (!items.length) {
    return (
      <div className="wm-finance-empty">
        <span>STANDBY</span>
        <strong>{payload?.title || 'Finance panel'} warming</strong>
      </div>
    );
  }
  if (mode === 'feed') {
    return <div className="wm-finance-feed-list">{items.map((item, index) => <FeedRow item={item} key={itemKey(item, index)} />)}</div>;
  }
  if (mode === 'grid') {
    return <div className="wm-finance-grid-list">{items.map((item, index) => <GridTile item={item} key={itemKey(item, index)} />)}</div>;
  }
  return <div className="wm-finance-list">{items.map((item, index) => <QuoteRow item={item} key={itemKey(item, index)} />)}</div>;
}

function FinanceWatchPanel({ config, payload }: { config: FinancePanelConfig; payload?: RuntimeFinanceWatchPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const mode = config.mode || 'rows';
  const count = useMemo(() => payload?.items?.length || 0, [payload?.items]);
  return (
    <Panel
      title={config.title}
      titleControls={<button type="button" className="wm-panel-help-button" aria-label={`Explain ${config.title}`} aria-expanded={showHelp} onClick={() => setShowHelp((current) => !current)}>?</button>}
      badge={statusBadge(payload)}
      status={payload?.status === 'ok' ? 'live' : 'muted'}
      count={count}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>{config.title}</strong>
          <p>{config.question}</p>
        </div>
      ) : null}
      className={`wm-market-panel wm-finance-watch-panel mode-${mode}`}
      dataPanelId={config.id}
    >
      <FinanceWatchView payload={payload} mode={mode} />
    </Panel>
  );
}

export function createFinanceWatchPanel(config: FinancePanelConfig) {
  const limit = config.limit || 10;
  const renderers: PanelRenderMap = {
    [config.id]: {
      render: (ctx) => <FinanceWatchPanel config={config} payload={ctx.runtimeData[config.id] as RuntimeFinanceWatchPayload | undefined} />,
    },
  };
  return runtimePanelFromRenderer(renderers, {
    id: config.id,
    title: config.title,
    eyebrow: 'finance',
    description: config.description,
    defaultEnabled: true,
  }, {
    tier: 'slow',
    intervalMs: 300000,
    fetchData: () => fetchRuntimeFinanceWatchPanel(config.id, limit),
  });
}
