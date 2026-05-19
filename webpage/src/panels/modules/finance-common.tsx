import { formatRelative } from '../shared/formatters';
import type { RuntimeFinanceCoverageKey, RuntimeFinanceLinkedMarket } from '@/types';

export function numberLabel(value?: string | number | null, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(numeric);
}

export function moneyLabel(value?: string | number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric)}`;
}

export function percentLabel(value?: string | number | null, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${normalized.toFixed(digits)}%`;
}

export function signedPercentLabel(value?: string | number | null, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

export function dateLabel(value?: string | null) {
  if (!value) return 'OPEN';
  const relative = formatRelative(value);
  return relative.replace(' ago', '').replace('in ', '').toUpperCase();
}

export function badgeLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok' || normalized === 'live') return undefined;
  if (normalized === 'warming') return 'WARMING';
  if (normalized === 'degraded' || normalized === 'partial') return 'PARTIAL';
  return 'STALE';
}

export function panelTone(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

export function sortCycle<T extends string>(items: T[], current: T) {
  const index = items.indexOf(current);
  return items[(index + 1) % items.length] || items[0] || current;
}

export function coverageTone(value?: string | null) {
  const key = String(value || '').toLowerCase();
  if (key === 'clob' || key === 'quote' || key === 'flow') return 'ok';
  if (key === 'earn' || key === 'sec' || key === 'perp' || key === 'etf') return 'watch';
  if (key === 'oracle') return 'cool';
  return 'neutral';
}

export function CoverageBadges({ items, max = 4 }: { items?: RuntimeFinanceCoverageKey[]; max?: number }) {
  const values = (items || []).slice(0, max);
  if (!values.length) return <span className="wm-finance-chip neutral">NO SRC</span>;
  return (
    <div className="wm-finance-chip-row">
      {values.map((item) => (
        <span key={item} className={`wm-finance-chip ${coverageTone(item)}`}>{String(item).toUpperCase()}</span>
      ))}
    </div>
  );
}

export function LinkedMarketMini({ market }: { market?: RuntimeFinanceLinkedMarket | null }) {
  if (!market) return <span className="wm-finance-muted">NO LINK</span>;
  return (
    <div className="wm-finance-linked-mini">
      <strong>{percentLabel(market.probability)}</strong>
      <span>{moneyLabel(market.volume24h)}</span>
    </div>
  );
}

export function FinanceMark({ label, tone = 'neutral' }: { label: string; tone?: string }) {
  return (
    <span className={`wm-finance-mark ${tone}`} aria-hidden="true">
      <i />
      <em>{label}</em>
    </span>
  );
}
