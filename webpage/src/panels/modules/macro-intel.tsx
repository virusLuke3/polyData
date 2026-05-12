import type { RuntimePolymarketMacroMapItem, RuntimePolymarketMacroMapPayload } from '@/types';
import { formatRelative } from '../shared/formatters';

function numberLabel(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function probabilityLabel(value?: string | number | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n * 100)}%`;
}

function normalized(value?: string | null) {
  return String(value || '').toLowerCase();
}

export function signalToneClass(value?: string | null) {
  const text = normalized(value);
  if (/(hot|rising|hawk|alert|high|sticky|underpriced)/.test(text)) return 'hot';
  if (/(cool|cooling|dovish|disinflation|soft|low)/.test(text)) return 'cool';
  if (/(watch|mixed|event|partial|degraded|warming)/.test(text)) return 'watch';
  return 'neutral';
}

export function sourceStateTone(value?: string | null) {
  const text = normalized(value);
  if (text === 'ok' || text === 'live' || text === 'official' || text === 'seeded') return 'ok';
  if (text === 'fallback' || text === 'partial' || text === 'degraded') return 'watch';
  if (text === 'error' || text === 'stale' || text === 'warming') return 'bad';
  return 'neutral';
}

export function SourceStack({ sources, labels }: { sources?: Record<string, string>; labels?: Record<string, string> }) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return null;
  return (
    <div className="wm-macro-source-stack">
      {entries.slice(0, 6).map(([key, value]) => (
        <span key={key} className={`wm-source-pill ${sourceStateTone(value)}`}>
          <strong>{labels?.[key] || key}</strong>
          <em>{String(value || 'unknown').toUpperCase()}</em>
        </span>
      ))}
    </div>
  );
}

export function MarketImplicationStrip({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="wm-market-implication-strip">
      {items.slice(0, 4).map((item, index) => (
        <span key={`${item}-${index}`}>{item}</span>
      ))}
    </div>
  );
}

export function linkedMacroMarkets(payload?: RuntimePolymarketMacroMapPayload | null, categoryIds: string[] = []): RuntimePolymarketMacroMapItem[] {
  const wanted = new Set(categoryIds.map((item) => item.toLowerCase()));
  return (payload?.items || []).filter((item) => {
    const ids = (item.categoryIds || []).map((id) => String(id || '').toLowerCase());
    return ids.some((id) => wanted.has(id));
  });
}

export function LinkedMarketRegistry({
  title = 'Linked PMKT',
  items,
  emptyLabel = 'No linked market seeded',
}: {
  title?: string;
  items: RuntimePolymarketMacroMapItem[];
  emptyLabel?: string;
}) {
  return (
    <div className="wm-linked-market-registry">
      <div className="wm-linked-market-header">
        <span>{title}</span>
        <em>{items.length ? `${items.length} markets` : emptyLabel}</em>
      </div>
      {items.slice(0, 3).map((item, index) => {
        const top = item.topOutcomes?.[0];
        return (
          <div className="wm-linked-market-row" key={`${item.eventId || item.slug || 'market'}-${index}`}>
            <div>
              <span>{(item.categoryLabels?.[0] || 'PMKT').toUpperCase()} / {item.endDate ? formatRelative(item.endDate) : 'OPEN'}</span>
              <strong>{item.title || 'Macro market'}</strong>
            </div>
            <em>{probabilityLabel(top?.yesPrice)}</em>
          </div>
        );
      })}
      {items.length ? (
        <div className="wm-linked-market-volume">
          <span>VOL</span>
          <strong>{numberLabel(items.reduce((sum, item) => sum + (Number(item.volume24h) || 0), 0))}</strong>
        </div>
      ) : null}
    </div>
  );
}
