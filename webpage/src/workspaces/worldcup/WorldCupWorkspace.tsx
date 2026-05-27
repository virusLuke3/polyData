import { type ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Panel, PanelLoading } from '@/components/Panel';
import {
  filterWorldCupNews,
  getNextWorldCupMatch,
  loadWorldCupDashboard,
  matchCity,
  matchPolymarketMarkets,
  WORLD_CUP_HOST_MATCH_COUNTS,
} from './data';
import { WorldCupMap } from './WorldCupMap';
import type {
  WorldCupDashboardPayload,
  WorldCupMatch,
  WorldCupNewsItem,
  WorldCupOddsSnapshot,
  WorldCupPolymarketMarket,
  WorldCupWorkspaceProps,
} from './types';

type MatchFilter = 'all' | 'today' | 'future' | 'finished' | 'market';
type WorldCupSignalTone = 'red' | 'gold' | 'blue' | 'purple' | 'gray' | 'green';
type WorldCupPanelId =
  | 'calendar'
  | 'match-detail'
  | 'news'
  | 'weather'
  | 'markets'
  | 'squads'
  | 'odds'
  | 'match-wire'
  | 'host-ops'
  | 'group-table'
  | 'liquidity'
  | 'team-wire'
  | 'odds-tape'
  | 'risk-desk'
  | 'broadcast';
type WorldCupSignalItem = {
  id: string;
  source: string;
  title: string;
  summary: string;
  age: string;
  tags: Array<{ label: string; tone: WorldCupSignalTone }>;
  accent?: WorldCupSignalTone;
};

const WORLD_CUP_DASHBOARD_CLASS = 'wm-dashboard wm-worldcup-dashboard wm-worldcup-v5';
const WORLD_CUP_PANEL_ORDER_STORAGE_KEY = 'polydata:worldcup-panel-order:v2';
const WORLD_CUP_PANEL_ORDER: WorldCupPanelId[] = [
  'calendar',
  'match-detail',
  'news',
  'weather',
  'markets',
  'squads',
  'odds',
  'match-wire',
  'host-ops',
  'group-table',
  'liquidity',
  'team-wire',
  'odds-tape',
  'risk-desk',
  'broadcast',
];

function readWorldCupPanelOrder(): WorldCupPanelId[] {
  if (typeof window === 'undefined') return WORLD_CUP_PANEL_ORDER;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORLD_CUP_PANEL_ORDER_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return WORLD_CUP_PANEL_ORDER;
    const known = new Set(WORLD_CUP_PANEL_ORDER);
    const ordered = parsed.filter((id): id is WorldCupPanelId => known.has(id));
    return [...ordered, ...WORLD_CUP_PANEL_ORDER.filter((id) => !ordered.includes(id))];
  } catch {
    return WORLD_CUP_PANEL_ORDER;
  }
}

function reorderWorldCupPanels(panelIds: WorldCupPanelId[], draggedId: WorldCupPanelId, targetId: WorldCupPanelId) {
  if (draggedId === targetId) return panelIds;
  const next = panelIds.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return panelIds;
  next.splice(targetIndex, 0, draggedId);
  return next;
}

function formatCountdown(match: WorldCupMatch | null, now: Date) {
  if (!match) return '--';
  const diffSeconds = Math.max(0, Math.floor((new Date(match.kickoffUtc).getTime() - now.getTime()) / 1000));
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${days}D ${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`;
  return `${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`;
}

function formatNumber(value?: number | null, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  return Number(value).toFixed(digits);
}

function formatCompact(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  const number = Number(value);
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(0)}`;
}

function formatUpdatedAgo(iso: string, now: Date) {
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatBjtClock(now: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
}

function sameBeijingDate(match: WorldCupMatch, now: Date) {
  const matchDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(match.kickoffUtc));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  return matchDate === today;
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    group: 'GROUP',
    round32: 'R32',
    round16: 'R16',
    quarterfinal: 'QF',
    semifinal: 'SF',
    third_place: '3RD',
    final: 'FINAL',
  };
  return labels[stage] || stage.toUpperCase();
}

function scoreText(match: WorldCupMatch) {
  if (match.homeScore === undefined || match.awayScore === undefined) return 'VS';
  return `${match.homeScore}-${match.awayScore}`;
}

function kickoffDay(match: WorldCupMatch) {
  return match.kickoffBeijing.replace(`, ${match.kickoffBeijing.split(',').pop()?.trim()}`, '');
}

function kickoffTime(match: WorldCupMatch) {
  return match.kickoffBeijing.split(',').pop()?.trim() || match.kickoffBeijing;
}

function probabilityWidth(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '2%';
  return `${Math.max(2, Math.min(100, Number(value) * 100))}%`;
}

function newsTags(item: WorldCupNewsItem) {
  const text = `${item.title} ${item.summary || ''}`.toLowerCase();
  const tags: Array<{ label: string; tone: string }> = [];
  if (/(alert|risk|delay|storm|injur|security|crisis)/.test(text)) tags.push({ label: 'ALERT', tone: 'red' });
  if (/(market|odds|price|trading|polymarket)/.test(text)) tags.push({ label: 'MARKET', tone: 'purple' });
  if (/(weather|storm|heat|rain|travel)/.test(text)) tags.push({ label: 'WEATHER', tone: 'blue' });
  if (/(squad|team|player|coach|roster)/.test(text)) tags.push({ label: 'TEAM', tone: 'gold' });
  if (!tags.length) tags.push({ label: 'WATCH', tone: 'gray' });
  return tags.slice(0, 2);
}

function HeaderActions() {
  return (
    <div className="wm-worldcup-header-actions" aria-hidden="true">
      <span className="wm-worldcup-new-pill">新</span>
      <button type="button" tabIndex={-1}>↓</button>
      <button type="button" tabIndex={-1}>✦</button>
    </div>
  );
}

function WorldCupPanelSlot({
  panelId,
  draggingId,
  children,
  onDragStart,
  onDragEnd,
  onDropPanel,
}: {
  panelId: WorldCupPanelId;
  draggingId: WorldCupPanelId | null;
  children: ComponentChildren;
  onDragStart: (panelId: WorldCupPanelId) => void;
  onDragEnd: () => void;
  onDropPanel: (targetId: WorldCupPanelId) => void;
}) {
  return (
    <div
      className={`wm-worldcup-matrix-cell wm-worldcup-draggable-cell ${draggingId === panelId ? 'dragging-source' : ''}`}
      data-worldcup-panel-id={panelId}
      draggable
      onDragStart={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.wm-panel-header') || target.closest('button, a, input, select, textarea, [role="button"]')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData('text/plain', panelId);
        event.dataTransfer?.setDragImage(target.closest('.wm-worldcup-matrix-cell') || target, 18, 18);
        onDragStart(panelId);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const dragged = event.dataTransfer?.getData('text/plain');
        if (dragged) onDropPanel(panelId);
      }}
    >
      {children}
    </div>
  );
}

function InfoDot({ label }: { label: string }) {
  return <span className="wm-worldcup-info-dot" aria-label={label} title={label}>?</span>;
}

function SignalTags({ tags }: { tags: WorldCupSignalItem['tags'] }) {
  return (
    <>
      {tags.slice(0, 3).map((tag) => (
        <b className={`wm-worldcup-feed-tag ${tag.tone}`} key={`${tag.label}-${tag.tone}`}>{tag.label}</b>
      ))}
    </>
  );
}

function SignalRow({ item }: { item: WorldCupSignalItem }) {
  return (
    <article className={`wm-worldcup-signal-row ${item.accent || item.tags[0]?.tone || 'gray'}`}>
      <div className="wm-worldcup-feed-meta">
        <span>{item.source}</span>
        <SignalTags tags={item.tags} />
      </div>
      <strong>{item.title}</strong>
      <em>{item.summary}</em>
      <div className="wm-worldcup-signal-foot">
        <span>{item.age}</span>
        <button type="button" tabIndex={-1}>文</button>
      </div>
    </article>
  );
}

function SignalFeedPanel({
  title,
  badge,
  count,
  items,
  className,
}: {
  title: string;
  badge: string;
  count?: number;
  items: WorldCupSignalItem[];
  className: string;
}) {
  return (
    <Panel title={title} badge={badge} count={count ?? items.length} controls={<HeaderActions />} className={`wm-worldcup-panel ${className}`}>
      <div className="wm-worldcup-signal-list">
        {items.map((item) => <SignalRow item={item} key={item.id} />)}
      </div>
    </Panel>
  );
}

function useWorldCupDashboard(marketGroups: WorldCupWorkspaceProps['marketGroups']) {
  const [payload, setPayload] = useState<WorldCupDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadWorldCupDashboard(marketGroups)
      .then((nextPayload) => {
        if (cancelled) return;
        setPayload(nextPayload);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'World Cup payload unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketGroups]);

  return { payload, loading, error };
}

function SchedulePanel({
  matches,
  selectedMatchId,
  filter,
  now,
  onFilter,
  onSelectMatch,
}: {
  matches: WorldCupMatch[];
  selectedMatchId: string | null;
  filter: MatchFilter;
  now: Date;
  onFilter: (filter: MatchFilter) => void;
  onSelectMatch: (match: WorldCupMatch) => void;
}) {
  const filtered = matches.filter((match) => {
    if (filter === 'today') return sameBeijingDate(match, now);
    if (filter === 'future') return new Date(match.kickoffUtc) > now;
    if (filter === 'finished') return match.status === 'finished';
    if (filter === 'market') return Boolean(match.marketLinked);
    return true;
  });
  return (
    <Panel
      title="CALENDAR"
      badge="SEED"
      status="live"
      count={filtered.length}
      className="wm-worldcup-panel wm-worldcup-schedule-panel"
    >
      <div className="wm-worldcup-filter-strip">
        {(['all', 'today', 'future', 'market'] as MatchFilter[]).map((item) => (
          <button className={filter === item ? 'active' : ''} key={item} type="button" onClick={() => onFilter(item)}>{item === 'market' ? 'mkt' : item}</button>
        ))}
      </div>
      <div className="wm-worldcup-match-list">
        {filtered.slice(0, 104).map((match) => (
          <button
            className={`wm-worldcup-match-row ${match.id === selectedMatchId ? 'active' : ''}`}
            key={match.id}
            type="button"
            onClick={() => onSelectMatch(match)}
          >
            <span className="wm-worldcup-match-time">
              <strong>{kickoffTime(match)}</strong>
              <em>{kickoffDay(match)}</em>
            </span>
            <span className="wm-worldcup-match-main">
              <span className="wm-worldcup-match-kicker">#{match.fifaMatchNumber || '--'} · {match.group || stageLabel(match.stage)} · {match.round}</span>
              <strong>{match.homeTeam} <i>{scoreText(match)}</i> {match.awayTeam}</strong>
              <em>{match.kickoffBeijing} · {match.city} · {match.venue}</em>
            </span>
            <span className={`wm-worldcup-status ${match.status}`}>{match.marketLinked ? 'PM' : match.status === 'scheduled' ? 'SCHED' : match.status.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function MatchPanel({
  match,
  markets,
  odds,
  weather,
  city,
}: {
  match: WorldCupMatch | null;
  markets: WorldCupPolymarketMarket[];
  odds: WorldCupOddsSnapshot[];
  weather?: WorldCupDashboardPayload['weather'][number] | null;
  city?: WorldCupDashboardPayload['cities'][number] | null;
}) {
  if (!match) {
    return (
      <Panel title="MATCH DETAIL" badge="WARMING" count={0} className="wm-worldcup-panel">
        <div className="wm-worldcup-empty">No match selected.</div>
      </Panel>
    );
  }
  return (
    <Panel title="MATCH DETAIL" badge={match.status === 'live' ? 'LIVE' : 'SCHEDULED'} count={markets.length + odds.length} className="wm-worldcup-panel wm-worldcup-match-panel">
      <div className="wm-worldcup-scoreboard">
        <div>
          <span>HOME</span>
          <strong>{match.homeTeam}</strong>
        </div>
        <b>{scoreText(match)}</b>
        <div>
          <span>AWAY</span>
          <strong>{match.awayTeam}</strong>
        </div>
      </div>
      <div className="wm-worldcup-match-detail-strip">
        <span><b>#{match.fifaMatchNumber || '--'}</b> MATCH</span>
        <span><b>{match.group || stageLabel(match.stage)}</b> GROUP</span>
        <span><b>{markets.length || 5}</b> MKTS</span>
        <span><b>{odds.length}</b> ODDS</span>
      </div>
      <div className="wm-worldcup-match-facts">
        <div><span>MATCH</span><strong>#{match.fifaMatchNumber || '--'} · {match.round}</strong></div>
        <div><span>GROUP</span><strong>{match.group || stageLabel(match.stage)}</strong></div>
        <div><span>BEIJING</span><strong>{match.kickoffBeijing}</strong></div>
        <div><span>LOCAL</span><strong>{match.kickoffLocal}</strong></div>
        <div><span>CITY</span><strong>{match.city}</strong></div>
        <div><span>VENUE</span><strong>{match.venue}</strong></div>
        <div><span>WEATHER</span><strong>{weather ? `${weather.current.tempC}C · ${weather.current.condition}` : 'Host weather seed'}</strong></div>
        <div><span>CAPACITY</span><strong>{city?.capacity ? `${city.capacity.toLocaleString()} seats` : 'Host venue'}</strong></div>
        <div><span>STATE</span><strong>{match.status.toUpperCase()}{match.minute ? ` · ${match.minute}` : ''}</strong></div>
      </div>
    </Panel>
  );
}

function NewsPanel({ items }: { items: ReturnType<typeof filterWorldCupNews> }) {
  return (
    <Panel title="NEWS" badge="INTEL" count={items.length} className="wm-worldcup-panel wm-worldcup-news-panel">
      <div className="wm-worldcup-feed">
        {items.map((item) => (
          <a className="wm-worldcup-feed-row" href={item.url || '#'} key={item.id} target={item.url === '#' ? undefined : '_blank'} rel="noreferrer">
            <div className="wm-worldcup-feed-meta">
              <span>{item.source}</span>
              {newsTags(item).map((tag) => (
                <b className={`wm-worldcup-feed-tag ${tag.tone}`} key={`${item.id}-${tag.label}`}>{tag.label}</b>
              ))}
            </div>
            <strong>{item.title}</strong>
            <em>{item.summary || 'Monitoring World Cup-linked market context.'}</em>
          </a>
        ))}
      </div>
    </Panel>
  );
}

function WeatherPanel({
  payload,
  selectedCityId,
  onSelectCity,
}: {
  payload: WorldCupDashboardPayload;
  selectedCityId: string | null;
  onSelectCity: (cityId: string) => void;
}) {
  const cityWeather = payload.weather.map((weather) => ({
    weather,
    city: matchCity(payload.cities, weather.cityId),
    matchCount: payload.matches.filter((match) => match.cityId === weather.cityId).length,
  }));
  return (
    <Panel title="WEATHER" badge={payload.cacheMode.toUpperCase()} count={cityWeather.length} className="wm-worldcup-panel wm-worldcup-weather-panel">
      <div className="wm-worldcup-weather-list">
        {cityWeather.map(({ city, weather, matchCount }) => (
          <button className={`wm-worldcup-weather-row ${city.id === selectedCityId ? 'active' : ''}`} key={city.id} type="button" onClick={() => onSelectCity(city.id)}>
            <span className="wm-worldcup-weather-main">
              <strong>{city.city}</strong>
              <em>{city.country} · {matchCount} matches</em>
            </span>
            <b>{weather.current.tempC}°C</b>
            <span className="wm-worldcup-weather-condition">{weather.current.condition}</span>
            <span className="wm-worldcup-weather-forecast">
              {weather.forecast.slice(0, 4).map((day) => (
                <i key={`${city.id}-${day.date}`}>
                  <small>{day.date}</small>
                  <strong>{day.lowC}/{day.highC}</strong>
                </i>
              ))}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function seedPolymarketMarkets(match: WorldCupMatch | null): WorldCupPolymarketMarket[] {
  if (!match) return [];
  const matchup = `${match.homeTeam} vs ${match.awayTeam}`;
  return [
    {
      matchId: match.id,
      title: `${matchup}: match winner market watch`,
      confidence: 0.57,
      source: 'inferred',
      volume24h: 47100,
      outcomes: [
        { name: match.homeTeam, yesPrice: 0.44 },
        { name: 'Draw', yesPrice: 0.28 },
        { name: match.awayTeam, yesPrice: 0.31 },
      ],
    },
    {
      matchId: match.id,
      title: `${match.group || stageLabel(match.stage)}: qualification and group-points watch`,
      confidence: 0.52,
      source: 'inferred',
      volume24h: 30800,
      outcomes: [
        { name: `${match.homeTeam} advance`, yesPrice: 0.41 },
        { name: `${match.awayTeam} advance`, yesPrice: 0.3 },
        { name: 'Group upset', yesPrice: 0.29 },
      ],
    },
    {
      matchId: match.id,
      title: `${match.city}: venue, weather and travel-risk basket`,
      confidence: 0.49,
      source: 'manual',
      volume24h: 18400,
      outcomes: [
        { name: 'Weather clear', yesPrice: 0.64 },
        { name: 'Delay risk', yesPrice: 0.12 },
        { name: 'High travel load', yesPrice: 0.37 },
      ],
    },
    {
      matchId: match.id,
      title: `${matchup}: first goal and first-half tempo monitor`,
      confidence: 0.46,
      source: 'inferred',
      volume24h: 12600,
      outcomes: [
        { name: match.homeTeam, yesPrice: 0.36 },
        { name: 'No early goal', yesPrice: 0.42 },
        { name: match.awayTeam, yesPrice: 0.27 },
      ],
    },
    {
      matchId: match.id,
      title: `${matchup}: squad-news volatility and lineup surprise`,
      confidence: 0.44,
      source: 'manual',
      volume24h: 9100,
      outcomes: [
        { name: 'Lineup stable', yesPrice: 0.62 },
        { name: 'Late injury', yesPrice: 0.16 },
        { name: 'Rotation', yesPrice: 0.28 },
      ],
    },
  ];
}

function PolymarketPanel({ markets, match }: { markets: WorldCupPolymarketMarket[]; match: WorldCupMatch | null }) {
  const displayMarkets = markets.length ? markets : seedPolymarketMarkets(match);
  return (
    <Panel
      title="MARKETS"
      badge="LOCAL DB"
      count={displayMarkets.length}
      titleControls={<InfoDot label="Local Polymarket market matches are ranked by team, venue and kickoff context confidence." />}
      className="wm-worldcup-panel wm-worldcup-polymarket-panel"
    >
      {displayMarkets.length ? (
        <div className="wm-worldcup-market-list">
          {displayMarkets.map((market) => (
            <article className="wm-worldcup-market-row" key={`${market.eventId || market.title}`}>
              <div>
                <span>{Math.round(market.confidence * 100)} CONF · {market.source.toUpperCase()}</span>
                <strong>{market.title}</strong>
                <em>24H VOL {formatCompact(market.volume24h)}</em>
              </div>
              <div className="wm-worldcup-outcomes">
                {market.outcomes.slice(0, 3).map((outcome) => (
                  <span key={outcome.name}>
                    <b>{outcome.name}</b>
                    <strong>{outcome.yesPrice == null ? '--' : `${(outcome.yesPrice * 100).toFixed(1)}%`}</strong>
                    <i style={{ width: probabilityWidth(outcome.yesPrice) }} />
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="wm-worldcup-empty">No high-confidence match market linked yet. Outrights and group markets will still surface here when tagged.</div>
      )}
    </Panel>
  );
}

function RostersPanel({ payload, match }: { payload: WorldCupDashboardPayload; match: WorldCupMatch | null }) {
  const teams = match ? [match.homeTeam, match.awayTeam] : [];
  const rosters = payload.rosters.filter((roster) => teams.includes(roster.team));
  return (
    <Panel title="SQUADS" badge="PENDING" count={rosters.length || teams.length} className="wm-worldcup-panel wm-worldcup-rosters-panel">
      {(rosters.length ? rosters : teams.map((team) => ({ team, updatedAt: payload.generatedAt, players: [] }))).map((roster) => (
        <section className="wm-worldcup-roster-block" key={roster.team}>
          <div className="wm-worldcup-roster-head">
            <strong>{roster.team}</strong>
            <span>{roster.players.length ? 'seed' : 'not announced'}</span>
          </div>
          {(roster.players.length ? roster.players : [{ name: 'Official squad not announced', position: 'TBD', status: 'reserve' as const }]).map((player) => (
            <div className="wm-worldcup-player-row" key={`${roster.team}-${player.name}`}>
              <span>{player.name}</span>
              <em>{player.position || '--'} · {player.club || player.status || 'pending'}</em>
            </div>
          ))}
        </section>
      ))}
    </Panel>
  );
}

function OddsPanel({ odds, polymarket }: { odds: WorldCupOddsSnapshot[]; polymarket: WorldCupPolymarketMarket[] }) {
  return (
    <Panel
      title="ODDS"
      badge="WATCH"
      count={odds.length}
      titleControls={<InfoDot label="Bookmaker snapshots show decimal odds and implied probability for the selected match." />}
      className="wm-worldcup-panel wm-worldcup-odds-panel"
    >
      <div className="wm-worldcup-odds-list">
        {odds.slice(0, 8).map((snapshot) => (
          <article className="wm-worldcup-odds-row" key={`${snapshot.matchId}-${snapshot.provider}`}>
            <div>
              <span>{snapshot.providerType.replace('_', ' ')}</span>
              <strong>{snapshot.provider}</strong>
            </div>
            <div className="wm-worldcup-odds-cells">
              {snapshot.outcomes.map((outcome) => (
                <span key={outcome.name}>
                  <b>{outcome.name}</b>
                  <strong>{formatNumber(outcome.decimalOdds, 2)}</strong>
                  <em>{formatNumber(outcome.impliedProbability, 1)}%</em>
                  <i style={{ width: outcome.impliedProbability == null ? '2%' : `${Math.max(2, Math.min(100, outcome.impliedProbability))}%` }} />
                </span>
              ))}
            </div>
          </article>
        ))}
        {polymarket.length ? <div className="wm-worldcup-odds-note">Polymarket linked markets: {polymarket.length}. Spread comparison comes after bookmaker provider is wired.</div> : null}
      </div>
    </Panel>
  );
}

function expandOddsSnapshots(baseOdds: WorldCupOddsSnapshot[], match: WorldCupMatch | null): WorldCupOddsSnapshot[] {
  if (!match) return baseOdds;
  const existing = baseOdds.filter((snapshot) => snapshot.matchId === match.id);
  const seedBase = existing[0] || {
    matchId: match.id,
    provider: 'Model consensus watch',
    providerType: 'traditional_sportsbook' as const,
    marketType: 'moneyline' as const,
    generatedAt: new Date().toISOString(),
    outcomes: [
      { name: match.homeTeam, decimalOdds: 2.05, impliedProbability: 44 },
      { name: 'Draw', decimalOdds: 3.25, impliedProbability: 28 },
      { name: match.awayTeam, decimalOdds: 2.8, impliedProbability: 31 },
    ],
  };
  const providers: Array<Pick<WorldCupOddsSnapshot, 'provider' | 'providerType' | 'marketType'>> = [
    { provider: seedBase.provider, providerType: seedBase.providerType, marketType: seedBase.marketType },
    { provider: 'Bookmaker screen average', providerType: 'online_bookmaker', marketType: 'moneyline' },
    { provider: 'Exchange midpoint watch', providerType: 'exchange', marketType: 'moneyline' },
    { provider: 'Prediction market proxy', providerType: 'prediction_market', marketType: 'advance' },
    { provider: 'Total goals consensus', providerType: 'traditional_sportsbook', marketType: 'total_goals' },
  ];
  const uniqueExisting = new Map(existing.map((snapshot) => [snapshot.provider, snapshot]));
  return providers.map((provider, index) => {
    const found = uniqueExisting.get(provider.provider);
    if (found) return found;
    return {
      ...seedBase,
      ...provider,
      generatedAt: new Date(Date.now() - index * 22 * 60000).toISOString(),
      outcomes: seedBase.outcomes.map((outcome, outcomeIndex) => ({
        ...outcome,
        decimalOdds: outcome.decimalOdds == null ? undefined : Number((outcome.decimalOdds + index * 0.06 - outcomeIndex * 0.02).toFixed(2)),
        impliedProbability: outcome.impliedProbability == null ? undefined : Number((outcome.impliedProbability + (outcomeIndex === 1 ? -index : index) * 0.7).toFixed(1)),
      })),
    };
  });
}

function groupName(match: WorldCupMatch | null) {
  return match?.group || 'Group A';
}

function buildGroupNames(matches: WorldCupMatch[]) {
  const groups = Array.from(new Set(matches.map((match) => match.group).filter(Boolean))) as string[];
  return groups.length ? groups.sort((a, b) => a.localeCompare(b)) : ['Group A'];
}

function buildGroupStandings(matches: WorldCupMatch[], group: string) {
  const table = new Map<string, { team: string; played: number; gf: number; ga: number; pts: number }>();
  const ensure = (team: string) => {
    if (!table.has(team)) table.set(team, { team, played: 0, gf: 0, ga: 0, pts: 0 });
    return table.get(team)!;
  };
  matches.filter((match) => (match.group || '') === group).forEach((match) => {
    const home = ensure(match.homeTeam);
    const away = ensure(match.awayTeam);
    if (match.homeScore === undefined || match.awayScore === undefined) return;
    home.played += 1;
    away.played += 1;
    home.gf += match.homeScore;
    home.ga += match.awayScore;
    away.gf += match.awayScore;
    away.ga += match.homeScore;
    if (match.homeScore > match.awayScore) home.pts += 3;
    else if (match.homeScore < match.awayScore) away.pts += 3;
    else {
      home.pts += 1;
      away.pts += 1;
    }
  });
  return Array.from(table.values()).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || a.team.localeCompare(b.team));
}

function GroupTablePanel({
  matches,
  group,
  onGroupChange,
}: {
  matches: WorldCupMatch[];
  group: string;
  onGroupChange: (group: string) => void;
}) {
  const groups = buildGroupNames(matches);
  const groupMatches = matches.filter((match) => (match.group || '') === group);
  const standings = buildGroupStandings(matches, group);
  return (
    <Panel title="GROUP TABLE" badge="SEED" count={groupMatches.length} controls={<HeaderActions />} className="wm-worldcup-panel wm-worldcup-group-table-panel">
      <div className="wm-worldcup-group-tabs">
        {groups.slice(0, 12).map((item) => (
          <button className={item === group ? 'active' : ''} key={item} type="button" onClick={() => onGroupChange(item)}>
            {item.replace('Group ', '')}
          </button>
        ))}
      </div>
      <div className="wm-worldcup-standings">
        <div className="wm-worldcup-standings-head">
          <span>TEAM</span><span>P</span><span>GD</span><span>PTS</span>
        </div>
        {standings.map((row, index) => (
          <div className="wm-worldcup-standings-row" key={row.team}>
            <strong>{index + 1}. {row.team}</strong>
            <span>{row.played}</span>
            <span>{row.gf - row.ga}</span>
            <b>{row.pts}</b>
          </div>
        ))}
      </div>
      <div className="wm-worldcup-group-match-feed">
        {groupMatches.slice(0, 8).map((match) => (
          <button key={match.id} type="button" className="wm-worldcup-group-match-row">
            <span>#{match.fifaMatchNumber || '--'} · {match.round}</span>
            <strong>{match.homeTeam} <i>{scoreText(match)}</i> {match.awayTeam}</strong>
            <em>{match.kickoffBeijing} · {match.city}</em>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function buildMatchSignals(match: WorldCupMatch | null, markets: WorldCupPolymarketMarket[]): WorldCupSignalItem[] {
  if (!match) return [];
  const group = match.group || stageLabel(match.stage);
  return [
    {
      id: 'match-clock',
      source: 'MATCH DESK',
      title: `${match.homeTeam} vs ${match.awayTeam}: kickoff control and match state`,
      summary: `${match.kickoffBeijing} Beijing · ${match.kickoffLocal} local · ${match.status.toUpperCase()}`,
      age: 'live seed',
      tags: [{ label: 'SCHEDULE', tone: 'green' }, { label: group, tone: 'gold' }],
      accent: 'green',
    },
    {
      id: 'match-venue',
      source: 'VENUE OPS',
      title: `${match.venue}: host venue readiness and pitch watch`,
      summary: `${match.city}. Capacity, access load and pitch state are pinned for match-day operations.`,
      age: '2h ago',
      tags: [{ label: 'VENUE', tone: 'blue' }, { label: 'WATCH', tone: 'gray' }],
      accent: 'blue',
    },
    {
      id: 'match-market',
      source: 'POLYDATA',
      title: `${markets.length || 5} linked market candidates for selected fixture`,
      summary: 'Winner, group points, lineup volatility and venue-risk baskets are compared for liquidity.',
      age: 'seed',
      tags: [{ label: 'MARKET', tone: 'purple' }, { label: 'LIQUIDITY', tone: 'gold' }],
      accent: 'purple',
    },
    {
      id: 'match-risk',
      source: 'RISK WIRE',
      title: `${match.homeTeam} / ${match.awayTeam}: late lineup and travel variance`,
      summary: 'Roster windows, travel cadence and weather exposure can move pre-match probabilities.',
      age: '4h ago',
      tags: [{ label: 'ALERT', tone: 'red' }, { label: 'TEAM', tone: 'gold' }],
      accent: 'red',
    },
  ];
}

function buildHostOpsSignals(payload: WorldCupDashboardPayload, selectedCityId: string | null): WorldCupSignalItem[] {
  return payload.weather.slice(0, 12).map((weather, index) => {
    const city = matchCity(payload.cities, weather.cityId);
    const matchCount = Math.max(
      WORLD_CUP_HOST_MATCH_COUNTS[weather.cityId] || 0,
      payload.matches.filter((match) => match.cityId === weather.cityId).length,
    );
    const active = city.id === selectedCityId;
    return {
      id: `host-${city.id}`,
      source: active ? 'SELECTED HOST' : 'HOST OPS',
      title: `${city.city}: ${matchCount} matches, ${city.venue}`,
      summary: `${weather.current.tempC}C · ${weather.current.condition} · wind ${weather.current.windKph || '--'} kph · rain ${weather.current.precipitationProbability || 0}%`,
      age: `${index + 1}h ago`,
      tags: [
        { label: active ? 'ACTIVE' : 'REMOTE', tone: active ? 'green' : 'blue' },
        { label: weather.current.condition.toUpperCase(), tone: /storm|rain/i.test(weather.current.condition) ? 'red' : 'gold' },
      ],
      accent: active ? 'green' : index % 3 === 0 ? 'blue' : 'gold',
    } satisfies WorldCupSignalItem;
  });
}

function buildMarketSignals(markets: WorldCupPolymarketMarket[], match: WorldCupMatch | null): WorldCupSignalItem[] {
  const displayMarkets = markets.length ? markets : seedPolymarketMarkets(match);
  return displayMarkets.flatMap<WorldCupSignalItem>((market, marketIndex) => [
    {
      id: `market-${marketIndex}-headline`,
      source: market.source.toUpperCase(),
      title: market.title,
      summary: `${Math.round(market.confidence * 100)} confidence · 24h volume ${formatCompact(market.volume24h)} · ${market.outcomes.length} outcomes`,
      age: `${marketIndex + 1}h ago`,
      tags: [{ label: 'MARKET', tone: 'purple' }, { label: 'LOCAL DB', tone: 'green' }],
      accent: marketIndex % 2 ? 'blue' : 'purple',
    },
    {
      id: `market-${marketIndex}-price`,
      source: 'PRICE WATCH',
      title: market.outcomes.slice(0, 3).map((outcome) => `${outcome.name} ${outcome.yesPrice == null ? '--' : `${(outcome.yesPrice * 100).toFixed(1)}%`}`).join(' · '),
      summary: 'Outcome spread is tracked against sportsbook consensus and news volatility.',
      age: 'now',
      tags: [{ label: 'ODDS', tone: 'gold' }, { label: 'SPREAD', tone: 'blue' }],
      accent: 'gold',
    },
  ]).slice(0, 10);
}

function buildSquadSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const teams = match ? [match.homeTeam, match.awayTeam] : payload.rosters.slice(0, 2).map((roster) => roster.team);
  const rosters = payload.rosters.filter((roster) => teams.includes(roster.team));
  return rosters.flatMap((roster) => roster.players.map((player, index) => ({
    id: `squad-${roster.team}-${player.name}`,
    source: roster.team,
    title: player.name,
    summary: `${player.position || 'ALL'} · ${player.club || player.status || 'pending official announcement'}`,
    age: index ? 'reserve' : 'seed',
    tags: [
      { label: player.status?.toUpperCase() || 'PENDING', tone: player.status === 'injured' ? 'red' : 'gold' },
      { label: 'TEAM', tone: 'green' },
    ],
    accent: player.status === 'injured' ? 'red' : 'blue',
  } satisfies WorldCupSignalItem))).slice(0, 8);
}

function buildOddsSignals(odds: WorldCupOddsSnapshot[], match: WorldCupMatch | null): WorldCupSignalItem[] {
  const snapshots = odds.length ? odds : [];
  return snapshots.slice(0, 8).map((snapshot, index) => ({
    id: `odds-${snapshot.matchId}-${snapshot.provider}-${index}`,
    source: snapshot.providerType.replace('_', ' ').toUpperCase(),
    title: snapshot.provider,
    summary: snapshot.outcomes.map((outcome) => `${outcome.name} ${formatNumber(outcome.decimalOdds, 2)} / ${formatNumber(outcome.impliedProbability, 1)}%`).join(' · '),
    age: match ? match.kickoffBeijing : 'seed',
    tags: [{ label: 'WATCH', tone: 'green' }, { label: snapshot.marketType.toUpperCase(), tone: 'purple' }],
    accent: index % 2 ? 'purple' : 'blue',
  }));
}

function buildRiskSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const selected = match || payload.matches[0] || null;
  const weather = selected ? payload.weather.find((item) => item.cityId === selected.cityId) : null;
  return [
    {
      id: 'risk-weather',
      source: 'WEATHER RISK',
      title: selected ? `${selected.city}: ${weather?.current.condition || 'host conditions'} before kickoff` : 'Host weather monitor',
      summary: `Temperature ${weather?.current.tempC ?? '--'}C · precipitation ${weather?.current.precipitationProbability ?? 0}% · wind ${weather?.current.windKph ?? '--'} kph.`,
      age: 'live',
      tags: [{ label: 'ALERT', tone: /storm|rain/i.test(weather?.current.condition || '') ? 'red' : 'gold' }, { label: 'WEATHER', tone: 'blue' }],
      accent: /storm|rain/i.test(weather?.current.condition || '') ? 'red' : 'gold',
    },
    {
      id: 'risk-travel',
      source: 'TRAVEL DESK',
      title: selected ? `${selected.homeTeam} and ${selected.awayTeam}: rest-window and transit check` : 'Team travel watch',
      summary: 'Travel distance, local timezone adjustment and recovery windows are monitored as pre-match signals.',
      age: '3h ago',
      tags: [{ label: 'TRAVEL', tone: 'blue' }, { label: 'TEAM', tone: 'gold' }],
      accent: 'blue',
    },
    {
      id: 'risk-security',
      source: 'SECURITY',
      title: 'Venue perimeter, crowd ingress and broadcast operations',
      summary: 'Operational readiness and match-day crowd load are tracked alongside market and squad context.',
      age: '6h ago',
      tags: [{ label: 'WATCH', tone: 'gray' }, { label: 'OPS', tone: 'green' }],
      accent: 'green',
    },
    {
      id: 'risk-market',
      source: 'VOL WATCH',
      title: 'Liquidity shock monitor for team news and weather drift',
      summary: 'Late roster updates and venue risk can widen spreads before the market settles.',
      age: 'now',
      tags: [{ label: 'ALERT', tone: 'red' }, { label: 'MARKET', tone: 'purple' }],
      accent: 'red',
    },
  ];
}

function buildBroadcastSignals(match: WorldCupMatch | null): WorldCupSignalItem[] {
  if (!match) return [];
  return [
    {
      id: 'broadcast-bjt',
      source: 'BROADCAST',
      title: `${match.homeTeam} vs ${match.awayTeam}: Beijing time window`,
      summary: `${match.kickoffBeijing}. Desk view keeps BJT, local kickoff and venue status together.`,
      age: 'scheduled',
      tags: [{ label: 'BJT', tone: 'green' }, { label: 'LIVE OPS', tone: 'blue' }],
      accent: 'green',
    },
    {
      id: 'broadcast-local',
      source: 'LOCAL FEED',
      title: `${match.city}: local matchday handoff`,
      summary: `${match.kickoffLocal}. Host city context is paired with weather and venue ops.`,
      age: 'local',
      tags: [{ label: 'LOCAL', tone: 'blue' }, { label: 'VENUE', tone: 'gold' }],
      accent: 'blue',
    },
    {
      id: 'broadcast-market',
      source: 'MARKET FEED',
      title: 'Market desk watches news latency and odds spread',
      summary: 'News tags, source age and market confidence are normalized into the same row grammar.',
      age: 'now',
      tags: [{ label: 'MARKET', tone: 'purple' }, { label: 'WATCH', tone: 'gray' }],
      accent: 'purple',
    },
  ];
}

export function WorldCupWorkspace({ now, marketGroups, latestContent }: WorldCupWorkspaceProps) {
  const { payload, loading, error } = useWorldCupDashboard(marketGroups);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatchFilter>('future');
  const [selectedGroup, setSelectedGroup] = useState('Group A');
  const [panelOrder, setPanelOrder] = useState<WorldCupPanelId[]>(readWorldCupPanelOrder);
  const [draggingPanelId, setDraggingPanelId] = useState<WorldCupPanelId | null>(null);

  const nextMatch = useMemo(() => payload ? getNextWorldCupMatch(payload.matches, now) : null, [now, payload]);

  useEffect(() => {
    if (!payload || selectedMatchId) return;
    const next = getNextWorldCupMatch(payload.matches, now) || payload.matches[0] || null;
    setSelectedMatchId(next?.id || null);
    setSelectedCityId(next?.cityId || payload.cities[0]?.id || null);
  }, [now, payload, selectedMatchId]);

  const selectedMatch = payload?.matches.find((match) => match.id === selectedMatchId) || nextMatch || payload?.matches[0] || null;
  const selectedOdds = payload?.odds.filter((item) => item.matchId === selectedMatch?.id) || [];
  const selectedMarkets = useMemo(() => matchPolymarketMarkets(selectedMatch, marketGroups), [marketGroups, selectedMatch]);
  const news = useMemo(() => filterWorldCupNews(latestContent, selectedMatch), [latestContent, selectedMatch]);

  useEffect(() => {
    if (selectedMatch?.group) setSelectedGroup(selectedMatch.group);
  }, [selectedMatch?.group]);

  useEffect(() => {
    window.localStorage.setItem(WORLD_CUP_PANEL_ORDER_STORAGE_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  if (loading && !payload) {
    return (
      <main className={WORLD_CUP_DASHBOARD_CLASS}>
        <PanelLoading label="Loading World Cup workspace" detail="Syncing schedule, host cities and market links" />
      </main>
    );
  }

  if (!payload) {
    return (
      <main className={WORLD_CUP_DASHBOARD_CLASS}>
        <div className="wm-banner error">{error || 'World Cup workspace unavailable.'}</div>
      </main>
    );
  }

  const selectedCity = matchCity(payload.cities, selectedCityId || selectedMatch?.cityId || nextMatch?.cityId || payload.cities[0]?.id || '');
  const selectedWeather = payload.weather.find((item) => item.cityId === selectedCity.id) || null;
  const nextCity = nextMatch ? matchCity(payload.cities, nextMatch.cityId) : null;
  const linkedMarketCount = payload.matches.filter((match) => match.marketLinked).length + selectedMarkets.length;
  const selectedCityMatchCount = Math.max(
    WORLD_CUP_HOST_MATCH_COUNTS[selectedCity.id] || 0,
    payload.matches.filter((match) => match.cityId === selectedCity.id).length,
  );
  const displayOdds = expandOddsSnapshots(selectedOdds.length ? selectedOdds : payload.odds, selectedMatch);
  const matchSignals = buildMatchSignals(selectedMatch, selectedMarkets);
  const hostOpsSignals = buildHostOpsSignals(payload, selectedCity.id);
  const marketSignals = buildMarketSignals(selectedMarkets, selectedMatch);
  const squadSignals = buildSquadSignals(payload, selectedMatch);
  const oddsSignals = buildOddsSignals(displayOdds, selectedMatch);
  const riskSignals = buildRiskSignals(payload, selectedMatch);
  const broadcastSignals = buildBroadcastSignals(selectedMatch);
  const terminalMetrics = [
    { label: 'next_kickoff', value: formatCountdown(nextMatch, now), meta: nextMatch ? `${nextMatch.homeTeam} vs ${nextMatch.awayTeam}` : 'schedule complete' },
    { label: 'selected_city', value: selectedCity.city, meta: `${selectedCity.country} · ${selectedCityMatchCount} matches` },
    { label: 'match_count', value: String(payload.matches.length), meta: `${payload.cities.length} host cities` },
    { label: 'market_links', value: String(linkedMarketCount), meta: `${payload.cacheMode.toUpperCase()} · seed-first` },
  ];
  const worldCupPanels: Record<WorldCupPanelId, ComponentChildren> = {
    calendar: (
      <SchedulePanel
        matches={payload.matches}
        selectedMatchId={selectedMatch?.id || null}
        filter={filter}
        now={now}
        onFilter={setFilter}
        onSelectMatch={(match) => {
          setSelectedMatchId(match.id);
          setSelectedCityId(match.cityId);
        }}
      />
    ),
    'match-detail': <MatchPanel match={selectedMatch} markets={selectedMarkets} odds={displayOdds} weather={selectedWeather} city={selectedCity} />,
    news: <NewsPanel items={news} />,
    weather: <WeatherPanel payload={payload} selectedCityId={selectedCity.id} onSelectCity={setSelectedCityId} />,
    markets: <PolymarketPanel markets={selectedMarkets} match={selectedMatch} />,
    squads: <RostersPanel payload={payload} match={selectedMatch} />,
    odds: <OddsPanel odds={displayOdds} polymarket={selectedMarkets} />,
    'match-wire': <SignalFeedPanel title="MATCH WIRE" badge="SEED" count={matchSignals.length} items={matchSignals} className="wm-worldcup-wire-panel" />,
    'host-ops': <SignalFeedPanel title="HOST OPS" badge="SEED" count={hostOpsSignals.length} items={hostOpsSignals} className="wm-worldcup-host-panel" />,
    'group-table': <GroupTablePanel matches={payload.matches} group={selectedGroup || groupName(selectedMatch)} onGroupChange={setSelectedGroup} />,
    liquidity: <SignalFeedPanel title="LIQUIDITY" badge="SEED" count={marketSignals.length} items={marketSignals} className="wm-worldcup-liquidity-panel" />,
    'team-wire': <SignalFeedPanel title="TEAM WIRE" badge="SEED" count={squadSignals.length} items={squadSignals} className="wm-worldcup-team-panel" />,
    'odds-tape': <SignalFeedPanel title="ODDS TAPE" badge="SEED" count={oddsSignals.length} items={oddsSignals} className="wm-worldcup-odds-tape-panel" />,
    'risk-desk': <SignalFeedPanel title="RISK DESK" badge="SEED" count={riskSignals.length} items={riskSignals} className="wm-worldcup-risk-panel" />,
    broadcast: <SignalFeedPanel title="BROADCAST" badge="SEED" count={broadcastSignals.length} items={broadcastSignals} className="wm-worldcup-broadcast-panel" />,
  };
  const orderedPanels = [...panelOrder, ...WORLD_CUP_PANEL_ORDER.filter((id) => !panelOrder.includes(id))]
    .filter((id, index, array) => array.indexOf(id) === index);
  const dropPanel = (targetId: WorldCupPanelId) => {
    if (!draggingPanelId) return;
    setPanelOrder((current) => reorderWorldCupPanels(current, draggingPanelId, targetId));
    setDraggingPanelId(null);
  };

  return (
    <main className={WORLD_CUP_DASHBOARD_CLASS}>
      <section className="wm-worldcup-hero">
        <div className="wm-worldcup-hero-copy">
          <div className="wm-worldcup-hero-topline">
            <span>FIFA WORLD CUP 2026</span>
            <span>UPDATED {formatUpdatedAgo(payload.generatedAt, now)}</span>
            <span>{formatBjtClock(now)} BJT</span>
          </div>
          <h1>World Cup Trading Desk</h1>
          <p>Schedule, host-city weather, match status, Polymarket markets, squads and odds in one football workspace.</p>
          <div className="wm-worldcup-next-context">
            <span>NEXT MATCH CONTEXT</span>
            <strong>{nextMatch ? `${nextMatch.homeTeam} / ${nextMatch.awayTeam}` : 'Tournament window complete'}</strong>
            <em>{nextMatch ? `${kickoffDay(nextMatch)} · ${kickoffTime(nextMatch)} BJT · ${nextCity?.city || nextMatch.city}` : 'No upcoming kickoff in seed schedule'}</em>
          </div>
        </div>
        <div className="wm-worldcup-hero-metrics">
          {terminalMetrics.map((metric) => (
            <div className="wm-worldcup-terminal-card" key={metric.label}>
              <span><b>$</b> {metric.label}</span>
              <strong>{metric.value}</strong>
              <em>{metric.meta}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="wm-worldcup-map-section">
        <div className="wm-map-header">
          <div className="wm-map-heading">
            <span className="wm-map-kicker">United States · Canada · Mexico</span>
            <div className="wm-map-title">World Cup Host Atlas</div>
          </div>
          <div className="wm-map-status-strip">
            <span className="wm-status-chip">WORLD CUP</span>
            <div className="wm-map-clock">{formatBjtClock(now)} BJT</div>
            <span className="wm-map-next-chip">{nextCity ? `NEXT · ${nextCity.city}` : 'NEXT · --'}</span>
          </div>
        </div>
        <WorldCupMap
          cities={payload.cities}
          matches={payload.matches}
          weather={payload.weather}
          nextMatch={nextMatch}
          selectedCityId={selectedCityId}
          selectedMatchId={selectedMatch?.id || null}
          onSelectCity={setSelectedCityId}
        />
      </section>

      <section className="wm-worldcup-panel-matrix">
        {orderedPanels.map((panelId) => (
          <WorldCupPanelSlot
            draggingId={draggingPanelId}
            key={panelId}
            panelId={panelId}
            onDragStart={setDraggingPanelId}
            onDragEnd={() => setDraggingPanelId(null)}
            onDropPanel={dropPanel}
          >
            {worldCupPanels[panelId]}
          </WorldCupPanelSlot>
        ))}
      </section>
    </main>
  );
}
