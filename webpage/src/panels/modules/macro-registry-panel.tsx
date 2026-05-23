import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { RuntimeMacroRegistryItem, RuntimeMacroRegistryPayload } from '@/types';
import { MacroAlertStrip, PanelGlyph, RowGlyph, SourceStack, StatusBadge, signalToneClass } from './macro-intel';
import type { PanelGlyphName } from './macro-intel';

export type MacroRegistryConfig = {
  panelId: string;
  title: string;
  badge: string;
  glyph: PanelGlyphName;
  helpTitle: string;
  helpText: string;
  emptyTitle: string;
  implicationItems: string[];
};

function panelStatus(status?: string | null): 'live' | 'muted' {
  return String(status || '').toLowerCase() === 'ok' ? 'live' : 'muted';
}

function rowGlyph(item: RuntimeMacroRegistryItem): PanelGlyphName {
  const text = `${item.group || ''} ${item.type || ''} ${item.label || ''}`.toLowerCase();
  if (/(oil|wti|energy)/.test(text)) return 'oil';
  if (/(gasoline|gas)/.test(text)) return 'gas';
  if (/(food|egg|meat)/.test(text)) return 'food';
  if (/(shelter|rent|oer|housing)/.test(text)) return 'home';
  if (/(job|labor|wage|claim|unemployment|nfp)/.test(text)) return 'labor';
  if (/(fed|sofr|funds|fomc)/.test(text)) return 'fed';
  if (/(2y|10y|rate|curve|treasury)/.test(text)) return 'rates';
  if (/(gdp|growth|retail|demand|recession)/.test(text)) return 'growth';
  if (/(tariff|policy|federal register|ustr)/.test(text)) return 'policy';
  if (/(cpi|pce|nowcast|inflation)/.test(text)) return 'cpi';
  return 'source';
}

function rowTone(item: RuntimeMacroRegistryItem) {
  const tone = String(item.tone || '').toLowerCase();
  if (tone === 'hot' || tone === 'cool' || tone === 'watch') return tone;
  return 'neutral';
}

function compactNumber(value?: number | string | null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function displayValue(value?: number | string | null) {
  const text = String(value ?? '').trim();
  return text || '--';
}

function RegistryRow({ item }: { item: RuntimeMacroRegistryItem }) {
  const tone = rowTone(item);
  const meta = String(item.group || item.domainTag || item.type || 'macro').toUpperCase();
  const source = String(item.sourceLabel || item.source || 'SOURCE').toUpperCase();
  const domain = String(item.domainTag || item.type || 'MACRO').toUpperCase();
  const rank = item.rank ? String(item.rank).padStart(2, '0') : null;
  return (
    <div className={`wm-macro-registry-row ${tone}`}>
      <RowGlyph icon={rowGlyph(item)} tone={tone} label={item.label || item.group || 'Macro row'} />
      <div className="wm-macro-registry-main">
        <div className="wm-macro-registry-meta">
          {rank ? <span className="wm-macro-registry-rank">{rank}</span> : null}
          <span>{meta}</span>
          <span className="wm-macro-registry-source">{source}</span>
          <span className={`wm-macro-registry-tag ${tone}`}>{domain}</span>
        </div>
        <strong>{item.label || 'Macro registry row'}</strong>
        <em>{item.implication || item.type || 'macro signal'}</em>
      </div>
      <div className="wm-macro-registry-right">
        <strong className="wm-macro-registry-value">{displayValue(item.valueLabel || item.value)}</strong>
        <StatusBadge tone={tone}>{item.changeLabel || item.severityLabel || '--'}</StatusBadge>
      </div>
    </div>
  );
}

export function MacroRegistryPanel({ config, payload }: { config: MacroRegistryConfig; payload?: RuntimeMacroRegistryPayload | null }) {
  const [showHelp, setShowHelp] = useState(false);
  const summary = payload?.summary;
  const items = payload?.items || [];
  const tone = signalToneClass(summary?.signal || summary?.bias || payload?.status);
  const status = String(payload?.status || '').toLowerCase();
  const badge = status && status !== 'ok' ? String(payload?.status || 'WARMING').toUpperCase() : undefined;
  const topMover = summary?.topMover;
  return (
    <Panel
      title={config.title}
      titleControls={(
        <button
          type="button"
          className="wm-panel-help-button"
          aria-label={`Explain ${config.title}`}
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          ?
        </button>
      )}
      badge={badge}
      status={panelStatus(payload?.status)}
      count={items.length}
      headerOverlay={showHelp ? (
        <div className="wm-panel-help-popover">
          <strong>{config.helpTitle}</strong>
          <p>{config.helpText}</p>
        </div>
      ) : null}
      className="wm-market-panel wm-macro-registry-panel"
      dataPanelId={config.panelId}
    >
      <div className={`wm-intel-signal-band ${tone}`}>
        <div className="wm-intel-signal-main">
          <PanelGlyph icon={config.glyph} tone={tone} />
          <div className="wm-intel-signal-copy">
            <span>{summary?.signalLabel || 'CPI macro registry'}</span>
            <strong>{summary?.signal || config.emptyTitle}</strong>
          </div>
        </div>
        <em>{config.badge}</em>
      </div>
      <div className="wm-macro-registry-scanbar" aria-label={`${config.title} source and coverage summary`}>
        <div>
          <span>TOP MOVE</span>
          <strong>{topMover?.label || summary?.topLabel || '--'}</strong>
        </div>
        <div>
          <span>MOVE</span>
          <strong>{topMover?.changeLabel || summary?.topChangeLabel || '--'}</strong>
        </div>
        <div>
          <span>SOURCES</span>
          <strong>{compactNumber(summary?.coverage)}/{compactNumber(summary?.sourceCount)}</strong>
        </div>
      </div>
      <MacroAlertStrip hot={summary?.hotCount} cool={summary?.coolCount} watch={summary?.watchCount} />
      <SourceStack sources={payload?.sources} />
      <div className="wm-macro-registry-list">
        {items.length ? items.map((item) => <RegistryRow key={item.key || `${item.group}-${item.label}`} item={item} />) : (
          <div className="wm-empty-state">
            <strong>{config.emptyTitle}</strong>
            <em>Seed cache has not composed this registry yet.</em>
          </div>
        )}
      </div>
    </Panel>
  );
}
