import type { RuntimePolymarketMacroMapItem, RuntimePolymarketMacroMapPayload } from '@/types';
import { formatRelative } from '../shared/formatters';

type PanelGlyphName = 'geo' | 'radar' | 'calendar' | 'energy' | 'basket' | 'market';

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

export function PanelGlyph({ icon, tone = 'neutral' }: { icon: PanelGlyphName; tone?: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };
  return (
    <span className={`wm-intel-glyph ${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {icon === 'geo' ? (
          <>
            <path {...common} d="M12 3l7 3v5c0 4.6-2.7 7.8-7 10-4.3-2.2-7-5.4-7-10V6l7-3z" />
            <path {...common} d="M8 11h8M12 7v8" />
          </>
        ) : null}
        {icon === 'radar' ? (
          <>
            <circle {...common} cx="12" cy="12" r="7" />
            <circle {...common} cx="12" cy="12" r="2" />
            <path {...common} d="M12 12l5-5M4 20h16" />
          </>
        ) : null}
        {icon === 'calendar' ? (
          <>
            <rect {...common} x="5" y="6" width="14" height="13" rx="2" />
            <path {...common} d="M8 4v4M16 4v4M5 10h14M9 14h1M14 14h1" />
          </>
        ) : null}
        {icon === 'energy' ? (
          <>
            <path {...common} d="M13 3C9 7.7 7 11.1 7 14a5 5 0 0010 0c0-2.9-1.5-5.4-4-11z" />
            <path {...common} d="M11 17c1.8-.5 2.8-1.7 3-3.6" />
          </>
        ) : null}
        {icon === 'basket' ? (
          <>
            <path {...common} d="M6 10h12l-1.4 9H7.4L6 10z" />
            <path {...common} d="M9 10l3-5 3 5M8 14h8M9 17h6" />
          </>
        ) : null}
        {icon === 'market' ? (
          <>
            <path {...common} d="M5 18V8M12 18V5M19 18v-7" />
            <path {...common} d="M4 18h16M7 11l5-4 5 3" />
          </>
        ) : null}
      </svg>
    </span>
  );
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
