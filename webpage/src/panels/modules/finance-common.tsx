import { type ComponentChildren } from 'preact';
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

export function signedNumberLabel(value?: string | number | null, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(digits)}`;
}

export function numericValue(value?: string | number | null, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
  if (key === 'clob' || key === 'quote' || key === 'flow') return 'source';
  if (key === 'earn' || key === 'sec' || key === 'perp' || key === 'etf' || key === 'oracle') return 'source';
  return 'neutral';
}

export function CoverageBadges({ items, max = 4 }: { items?: Array<RuntimeFinanceCoverageKey | string>; max?: number }) {
  const values = (items || []).slice(0, max);
  if (!values.length) return <span className="wm-finance-chip neutral">NO SRC</span>;
  return (
    <div className="wm-finance-chip-row">
      {values.map((item) => (
        <span key={item} className={`wm-finance-chip ${coverageTone(item)}`}>{String(item).toUpperCase()}</span>
      ))}
      {(items || []).length > max ? <span className="wm-finance-chip neutral">+{(items || []).length - max}</span> : null}
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

export function financeTone(value?: string | number | null) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 0) return 'ok';
    if (numeric < 0) return 'bad';
  }
  return 'neutral';
}

export function marketMoveTone(value?: string | number | null) {
  return financeTone(value);
}

export function basisTone(value?: string | number | null) {
  return financeTone(value);
}

export function severityTone(value?: string | null) {
  const text = String(value || '').toLowerCase();
  if (/(alert|critical|stress|hot|surge|thin|bad|negative)/.test(text)) return 'bad';
  if (/(watch|mixed|fragile|pending|warning)/.test(text)) return 'watch';
  if (/(ok|live|risk-on|strong|improving|positive|flow)/.test(text)) return 'ok';
  return 'neutral';
}

export function FinanceRail({ label, tone = 'neutral' }: { label: string; tone?: string }) {
  return (
    <div className={`wm-finance-rail ${tone}`}>
      <i />
      <span>{label}</span>
    </div>
  );
}

export function FinanceMetricStrip({
  items,
}: {
  items: Array<{ label: string; value: ComponentChildren; tone?: string }>;
}) {
  return (
    <div className="wm-finance-metric-strip">
      {items.map((item) => (
        <span key={item.label} className={item.tone || 'neutral'}>
          <em>{item.label}</em>
          <strong>{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

export function FinanceSummaryStrip({
  items,
}: {
  items: Array<{ label: string; value: ComponentChildren; tone?: string }>;
}) {
  return (
    <div className="wm-finance-summary-strip">
      {items.map((item) => (
        <span key={item.label} className={item.tone || 'neutral'}>
          <strong>{item.value}</strong>
          <em>{item.label}</em>
        </span>
      ))}
    </div>
  );
}

export function FinanceStatLine({
  items,
}: {
  items: Array<{ label: string; value: ComponentChildren; tone?: string }>;
}) {
  if (!items.length) return null;
  return (
    <div className="wm-finance-stat-line">
      {items.map((item) => (
        <span key={item.label} className={item.tone || 'neutral'}>
          <em>{item.label}</em>
          <strong>{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

export function FinanceSignalRow({
  tone = 'neutral',
  code,
  meta,
  title,
  stats,
  children,
  className = '',
}: {
  tone?: string;
  code: string;
  meta?: ComponentChildren;
  title: ComponentChildren;
  stats?: Array<{ label: string; value: ComponentChildren; tone?: string }>;
  children?: ComponentChildren;
  className?: string;
}) {
  return (
    <article className={`wm-finance-signal-row ${tone} ${className}`.trim()}>
      <div className="wm-finance-signal-rail"><span>{code}</span></div>
      <div className="wm-finance-signal-main">
        {meta ? <div className="wm-finance-signal-meta">{meta}</div> : null}
        <strong className="wm-finance-signal-title">{title}</strong>
        {stats?.length ? <FinanceStatLine items={stats} /> : null}
        {children}
      </div>
    </article>
  );
}

function hashSeed(seed?: string | number | null) {
  const text = String(seed || 'finance');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 9973;
  }
  return hash || 137;
}

function sparkPoints(seed?: string | number | null, bias = 0, count = 12) {
  const base = hashSeed(seed);
  const points: number[] = [];
  let value = 48 + (base % 17) - 8;
  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin((base + index * 13) * 0.33) * 8;
    const pulse = ((base + index * 19) % 11) - 5;
    value += bias * 5 + wave * 0.22 + pulse * 0.38;
    points.push(Math.max(12, Math.min(88, value)));
  }
  return points;
}

export function MiniSparkline({
  seed,
  tone = 'neutral',
  bias = 0,
}: {
  seed?: string | number | null;
  tone?: string;
  bias?: number;
}) {
  const values = sparkPoints(seed, bias);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value}`).join(' ');
  return (
    <svg className={`wm-finance-spark ${tone}`} viewBox="0 0 100 44" aria-hidden="true" focusable="false">
      <polyline points={points} />
    </svg>
  );
}

export function MiniBar({
  value,
  tone = 'neutral',
  max = 100,
}: {
  value?: string | number | null;
  tone?: string;
  max?: number;
}) {
  const width = `${Math.max(4, Math.min(100, (Math.abs(numericValue(value)) / max) * 100))}%`;
  return (
    <span className={`wm-finance-mini-bar ${tone}`}>
      <i style={{ width }} />
    </span>
  );
}
