import { Panel } from '@/components/Panel';
import type { RuntimeF1PanelCard } from '@/types';
import type { PanelRenderMap } from './types';
import { emptyState } from './shared/renderers';

function cardMarker(card: RuntimeF1PanelCard, index: number) {
  if (card.kind === 'news') return 'NEWS';
  return String(index + 1).padStart(2, '0');
}

function f1CardList(cards: RuntimeF1PanelCard[]) {
  if (!cards.length) return emptyState('No BWENews feed items loaded yet.');
  return (
    <div className="wm-f1-market-list">
      {cards.map((card, index) => (
        <a
          className={`wm-f1-card is-${card.status || 'upcoming'} is-${card.kind || 'meeting'}`}
          key={card.id || `${card.title || 'card'}-${index}`}
          style={{ borderLeftColor: card.accentColor || undefined }}
          href={card.url || undefined}
          target={card.url ? '_blank' : undefined}
          rel={card.url ? 'noreferrer' : undefined}
        >
          <div className="wm-f1-card-main">
            <div className="wm-f1-card-meta">
              <span className="wm-f1-card-dot" style={{ background: card.accentColor || undefined }} />
              <span>{card.topic || 'bwenews'}</span>
              <span>·</span>
              <span>{card.phase || card.status || '--'}</span>
              {card.detail ? (
                <>
                  <span>·</span>
                  <span>{card.detail}</span>
                </>
              ) : null}
            </div>
            <strong className="wm-f1-card-title">{card.title || 'BWENews update'}</strong>
            {card.summary ? <div className="wm-f1-card-summary">{card.summary}</div> : null}
            <div className="wm-f1-card-bottom">
              {card.primaryMetric ? <span className="wm-f1-card-primary">{card.primaryMetric}</span> : null}
              {card.secondaryMetric ? <span className="wm-f1-card-secondary">{card.secondaryMetric}</span> : null}
              {card.tertiaryMetric ? (
                <span className="wm-f1-card-tertiary" style={card.kind === 'result' && card.accentColor ? { color: card.accentColor } : undefined}>
                  {card.tertiaryMetric}
                </span>
              ) : null}
              {card.quaternaryMetric ? <span className="wm-f1-card-quaternary">{card.quaternaryMetric}</span> : null}
            </div>
          </div>
          <span className="wm-f1-card-marker" aria-hidden="true">{cardMarker(card, index)}</span>
        </a>
      ))}
    </div>
  );
}

export const f1PanelRenderers: PanelRenderMap = {
  'f1-trackside': {
    render: (ctx) => (
      <Panel title="BWE NEWS" badge="LIVE" status="live" count={ctx.f1?.cards.length || 0} className="wm-market-panel wm-f1-panel">
        {f1CardList(ctx.f1?.cards || [])}
      </Panel>
    ),
  },
};
