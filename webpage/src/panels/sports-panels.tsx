import { Panel } from '@/components/Panel';
import type { PanelRenderContext } from '@/types';
import type { PanelRenderMap } from './types';
import { formatDate } from './shared/formatters';
import { emptyState } from './shared/renderers';

function nbaIntelPanel(ctx: PanelRenderContext) {
  const intel = ctx.nbaIntel;
  if (!intel || (!intel.items.length && !intel.lineups.length)) {
    return emptyState('No NBA intel loaded.');
  }
  return (
    <div className="wm-panel-stack">
      {!!intel.lineups.length && (
        <section className="wm-subpanel">
          <div className="wm-subpanel-title">LINEUPS</div>
          <div className="wm-panel-list">
            {intel.lineups.slice(0, 3).map((game, index) => (
              <article className="wm-lineup-card" key={`${game.gameId || game.label}-${index}`}>
                <div className="wm-lineup-head">
                  <strong>{game.label || 'NBA matchup'}</strong>
                  <span>{game.status || '--'}</span>
                </div>
                <div className="wm-lineup-columns">
                  {['HOME', 'AWAY'].map((side) => (
                    <div className="wm-lineup-team" key={side}>
                      <div className="wm-lineup-team-label">{side}</div>
                      <div className="wm-lineup-players">
                        {(game.starters || []).filter((player) => player.side === side).slice(0, 5).map((player, playerIndex) => (
                          <div className="wm-lineup-player" key={`${side}-${player.playerName}-${playerIndex}`}>
                            <span>{player.playerName || '--'}</span>
                            <em>{player.position || player.lineupStatus || ''}</em>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!!intel.items.length && (
        <section className="wm-subpanel">
          <div className="wm-subpanel-title">ESPN / BEAT INTEL</div>
          <div className="wm-panel-list">
            {intel.items.slice(0, 8).map((item, index) => (
              <a className="wm-news-card" href={item.url || '#'} target="_blank" rel="noreferrer" key={`${item.url || item.headline}-${index}`}>
                <div className="wm-news-source">{item.source || 'ESPN'}</div>
                <div className="wm-news-title">{item.headline || 'NBA intel item'}</div>
                <div className="wm-news-meta">{formatDate(item.publishedAt || null)}</div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}


function nbaGames(items: NonNullable<PanelRenderContext['nba']>['items']) {
  if (!items.length) return emptyState('No NBA games loaded.');
  return (
    <div className="wm-panel-list">
      {items.map((game) => (
        <article className="wm-oracle-card" key={game.id || game.name}>
          <div className="wm-oracle-header">
            <strong>{game.awayTeam} @ {game.homeTeam}</strong>
            <span>{game.state || 'pre'}</span>
          </div>
          <div className="wm-summary-grid">
            <div className="wm-summary-row"><span>TIP</span><strong>{formatDate(game.tipoff || null)}</strong></div>
            <div className="wm-summary-row"><span>SCORE</span><strong>{`${game.awayScore ?? '-'} - ${game.homeScore ?? '-'}`}</strong></div>
          </div>
          <div className="wm-news-meta">{game.status || game.broadcast || '--'}</div>
        </article>
      ))}
    </div>
  );
}


export const sportsPanelRenderers: PanelRenderMap = {
  'nba-scoreboard': {
    render: (ctx) => (
      <Panel title="NBA SCOREBOARD" badge="SPORTS" status="live" count={ctx.nba?.items.length || 0}>
        {nbaGames(ctx.nba?.items || [])}
      </Panel>
    ),
  },
  'nba-intel': {
    size: 'wide',
    render: (ctx) => (
      <Panel title="NBA INTEL" badge="ESPN" status="live" count={ctx.nbaIntel?.items.length || 0}>
        {nbaIntelPanel(ctx)}
      </Panel>
    ),
  },
};

