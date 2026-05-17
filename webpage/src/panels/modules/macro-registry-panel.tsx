import { useState } from 'preact/hooks';
import { Panel } from '@/components/Panel';
import type { RuntimeMacroRegistryItem, RuntimeMacroRegistryPayload } from '@/types';
import { MacroAlertStrip, PanelGlyph, RowGlyph, StatusBadge, signalToneClass } from './macro-intel';
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

function RegistryRow({ item }: { item: RuntimeMacroRegistryItem }) {
  const tone = rowTone(item);
  const meta = String(item.group || item.type || item.implication || 'macro').toUpperCase();
  return (
    <div className={`wm-macro-registry-row ${tone}`}>
      <RowGlyph icon={rowGlyph(item)} tone={tone} label={item.label || item.group || 'Macro row'} />
      <div className="wm-macro-registry-main">
        <span>{meta}</span>
        <strong>{item.label || 'Macro registry row'}</strong>
        <em>{item.implication || item.type || 'macro signal'}</em>
      </div>
      <strong className="wm-macro-registry-value">{item.valueLabel || item.value || '--'}</strong>
      <StatusBadge tone={tone}>{item.changeLabel || '--'}</StatusBadge>
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
      <MacroAlertStrip hot={summary?.hotCount} cool={summary?.coolCount} watch={summary?.watchCount} />
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
