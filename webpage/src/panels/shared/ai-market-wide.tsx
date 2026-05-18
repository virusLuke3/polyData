import { useEffect, useMemo, useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import { fetchMarketWideAiInsights } from '@/services/api';
import type {
  MarketWideAiInsightLens,
  MarketWideAiInsightPayload,
  MarketWideAiInsightResponse,
  PanelRenderContext,
} from '@/types';
import { formatCompact, formatCurrencyCompact } from './formatters';
import { globalMarkets } from './selectors';

type AiMarketWidePanelProps = {
  ctx: PanelRenderContext;
  lens: MarketWideAiInsightLens;
  title: string;
  badge: string;
};

const PANEL_COPY: Record<MarketWideAiInsightLens, { section: string; fallbackTitle: string }> = {
  overview: { section: 'World Brief', fallbackTitle: 'Market universe loaded' },
  flow: { section: 'Flow Focus', fallbackTitle: 'Cross-market tape loaded' },
  oracle: { section: 'Oracle Watch', fallbackTitle: 'Resolution queue visible' },
};

function numericValue(value: string | number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function topMarkets(ctx: PanelRenderContext) {
  return globalMarkets(ctx)
    .slice()
    .sort((a, b) => numericValue(b.volume24h) - numericValue(a.volume24h))
    .slice(0, 48);
}

function topGroups(ctx: PanelRenderContext) {
  return ctx.marketGroups
    .slice()
    .sort((a, b) => numericValue(b.volume24h) - numericValue(a.volume24h))
    .slice(0, 36);
}

function buildMarketWidePayload(ctx: PanelRenderContext, lens: MarketWideAiInsightLens): MarketWideAiInsightPayload {
  return {
    lens,
    markets: topMarkets(ctx),
    marketGroups: topGroups(ctx),
    trades: (ctx.globalTrades || []).slice(0, 24),
    oracle: (ctx.globalOracle || []).slice(0, 24),
    content: (ctx.latestContent || []).slice(0, 12),
    alphaSignals: (ctx.alphaSignals?.items || []).slice(0, 10),
    whaleSignals: (ctx.whaleTrades?.items || []).slice(0, 10),
    suspiciousSignals: (ctx.suspiciousTrades?.items || []).slice(0, 10),
  };
}

function categorySummary(payload: MarketWideAiInsightPayload) {
  const counts = new Map<string, number>();
  payload.markets.forEach((market) => {
    const category = String(market.category || 'market').toLowerCase();
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => `${category} ${count}`)
    .join(' / ');
}

function localMarketWideFallback(payload: MarketWideAiInsightPayload): MarketWideAiInsightResponse {
  const volume = payload.markets.reduce((sum, market) => sum + numericValue(market.volume24h), 0)
    || payload.marketGroups.reduce((sum, group) => sum + numericValue(group.volume24h), 0);
  if (payload.lens === 'flow') {
    return {
      status: 'fallback',
      lens: payload.lens,
      model: 'local-market-wide-fallback',
      brief: `Cross-market flow shows ${formatCompact(payload.trades.length)} recent trade rows, ${formatCompact(payload.whaleSignals?.length || 0)} whale signals, and ${formatCompact(payload.suspiciousSignals?.length || 0)} suspicious-flow signals.`,
      focus: [
        { label: 'FLOW', title: 'Trade tape breadth', summary: `${formatCompact(payload.trades.length)} recent trades are visible across loaded markets.`, severity: 'positive', evidence: `${formatCompact(payload.trades.length)} trades` },
        { label: 'WHALES', title: 'Whale cluster watch', summary: `${formatCompact(payload.whaleSignals?.length || 0)} whale signals are loaded for market-wide review.`, severity: payload.whaleSignals?.length ? 'warning' : 'neutral', evidence: `${formatCompact(payload.whaleSignals?.length || 0)} signals` },
        { label: 'LIQUIDITY', title: 'Visible volume', summary: `Loaded markets show ${formatCurrencyCompact(volume)} in visible 24h volume.`, severity: 'neutral', evidence: formatCurrencyCompact(volume) },
      ],
      evidence: [`${formatCompact(payload.trades.length)} trades`, `${formatCompact(payload.whaleSignals?.length || 0)} whales`, formatCurrencyCompact(volume)],
    };
  }
  if (payload.lens === 'oracle') {
    return {
      status: 'fallback',
      lens: payload.lens,
      model: 'local-market-wide-fallback',
      brief: `Oracle watch is tracking ${formatCompact(payload.oracle.length)} recent resolution events across ${formatCompact(payload.markets.length)} loaded markets.`,
      focus: [
        { label: 'ORACLE', title: 'Resolution queue', summary: `${formatCompact(payload.oracle.length)} recent oracle events are visible.`, severity: payload.oracle.length ? 'warning' : 'neutral', evidence: `${formatCompact(payload.oracle.length)} events` },
        { label: 'RISK', title: 'Settlement timing', summary: 'Near-expiry markets should be read with proposal and dispute timing in mind.', severity: 'warning', evidence: 'resolution' },
        { label: 'BREADTH', title: 'Market coverage', summary: `${formatCompact(payload.markets.length)} active markets are covered by this watch.`, severity: 'neutral', evidence: `${formatCompact(payload.markets.length)} markets` },
      ],
      evidence: [`${formatCompact(payload.oracle.length)} oracle events`, `${formatCompact(payload.markets.length)} markets`, categorySummary(payload) || 'categories loading'],
    };
  }
  return {
    status: 'fallback',
    lens: payload.lens,
    model: 'local-market-wide-fallback',
    brief: `Market-wide dashboard covers ${formatCompact(payload.markets.length)} active markets and ${formatCompact(payload.marketGroups.length)} grouped markets. Top category breadth: ${categorySummary(payload) || 'loading'}.`,
    focus: [
      { label: 'BREADTH', title: 'Market universe', summary: `${formatCompact(payload.markets.length)} active markets and ${formatCompact(payload.marketGroups.length)} grouped markets are loaded.`, severity: 'positive', evidence: `${formatCompact(payload.markets.length)} markets` },
      { label: 'CATALYSTS', title: 'Context feed', summary: `${formatCompact(payload.content.length)} content items and ${formatCompact(payload.alphaSignals?.length || 0)} alpha signals are available.`, severity: payload.content.length ? 'positive' : 'warning', evidence: `${formatCompact(payload.content.length)} items` },
      { label: 'CONVERGENCE', title: 'Category concentration', summary: categorySummary(payload) || 'Category breadth is still loading.', severity: 'neutral', evidence: 'categories' },
    ],
    evidence: [`${formatCompact(payload.markets.length)} markets`, `${formatCompact(payload.marketGroups.length)} groups`, formatCurrencyCompact(volume)],
  };
}

function severityClass(severity?: string | null) {
  const normalized = String(severity || '').toLowerCase();
  if (/critical|risk|high|bear/.test(normalized)) return 'critical';
  if (/warning|watch|medium/.test(normalized)) return 'warning';
  if (/positive|bull|strong/.test(normalized)) return 'positive';
  return 'neutral';
}

function requestSignature(payload: MarketWideAiInsightPayload) {
  return JSON.stringify({
    lens: payload.lens,
    markets: payload.markets.length,
    groups: payload.marketGroups.length,
    trades: payload.trades[0]?.txHash || payload.trades.length,
    oracle: payload.oracle[0]?.txHash || payload.oracle.length,
    content: payload.content[0]?.id || payload.content.length,
    whales: payload.whaleSignals?.length || 0,
    suspicious: payload.suspiciousSignals?.length || 0,
  });
}

export function AiMarketWidePanel({ ctx, lens, title, badge }: AiMarketWidePanelProps) {
  const payload = useMemo(() => buildMarketWidePayload(ctx, lens), [
    ctx.alphaSignals,
    ctx.globalOracle,
    ctx.globalTrades,
    ctx.latestContent,
    ctx.marketGroups,
    ctx.markets,
    ctx.suspiciousTrades,
    ctx.whaleTrades,
    lens,
  ]);
  const signature = useMemo(() => requestSignature(payload), [payload]);
  const fallback = useMemo(() => localMarketWideFallback(payload), [payload]);
  const [insight, setInsight] = useState<MarketWideAiInsightResponse>(fallback);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInsight(fallback);
    setLoading(true);
    fetchMarketWideAiInsights(payload)
      .then((response) => {
        if (!cancelled) setInsight(response);
      })
      .catch(() => {
        if (!cancelled) setInsight(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fallback, payload, signature]);

  const focus = insight.focus?.length ? insight.focus : fallback.focus;
  const evidence = insight.evidence?.length ? insight.evidence : (fallback.evidence || []);
  const live = insight.status === 'live';
  const copy = PANEL_COPY[lens];

  return (
    <Panel
      title={title}
      badge={loading ? 'THINKING' : (live ? badge : 'LOCAL')}
      status={live ? 'live' : 'muted'}
      count={focus.length}
      className={`wm-market-panel wm-ai-market-panel wm-ai-market-wide-panel ${lens}`}
    >
      <div className="wm-ai-market">
        <section className="wm-ai-market-brief">
          <span>{copy.section}</span>
          <p>{insight.brief || fallback.brief}</p>
        </section>

        <section className="wm-ai-market-focus" aria-label={`${title} focus signals`}>
          <div className="wm-ai-market-section-head">
            <span>Focus</span>
            <em>{insight.viaGateway ? 'gateway' : (insight.model || 'local')}</em>
          </div>
          {focus.map((item, index) => (
            <article className={`wm-ai-market-card ${severityClass(item.severity)}`} key={`${lens}-${item.label}-${index}`}>
              <div className="wm-ai-market-card-head">
                <span>{item.label}</span>
                <b>{item.evidence || copy.fallbackTitle}</b>
              </div>
              <strong>{item.title || copy.fallbackTitle}</strong>
              <p>{item.summary}</p>
            </article>
          ))}
        </section>

        <section className="wm-ai-market-evidence" aria-label={`${title} evidence`}>
          {evidence.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
        </section>
      </div>
    </Panel>
  );
}

