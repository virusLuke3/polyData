import { type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  | 'broadcast'
  | 'official-facts'
  | 'injury-tracker'
  | 'lineup-watch'
  | 'player-pool'
  | 'xg-model'
  | 'tactical-matchup'
  | 'local-media'
  | 'ref-venue';
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
const WORLD_CUP_PANEL_ORDER_STORAGE_KEY = 'polydata:worldcup-panel-order:v3';
const WORLD_CUP_PANEL_DRAG_THRESHOLD = 5;
const WORLD_CUP_PANEL_ORDER: WorldCupPanelId[] = [
  'calendar',
  'match-detail',
  'news',
  'weather',
  'markets',
  'official-facts',
  'injury-tracker',
  'lineup-watch',
  'xg-model',
  'tactical-matchup',
  'squads',
  'odds',
  'group-table',
  'local-media',
  'ref-venue',
  'match-wire',
  'host-ops',
  'liquidity',
  'team-wire',
  'odds-tape',
  'risk-desk',
  'broadcast',
  'player-pool',
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

function reorderWorldCupPanels(panelIds: WorldCupPanelId[], draggedId: WorldCupPanelId, targetId: WorldCupPanelId, insertAfter: boolean) {
  if (draggedId === targetId) return panelIds;
  const next = panelIds.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return panelIds;
  next.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedId);
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
  onMovePanel,
  onDragStateChange,
}: {
  panelId: WorldCupPanelId;
  draggingId: WorldCupPanelId | null;
  children: ComponentChildren;
  onMovePanel: (draggedId: WorldCupPanelId, targetId: WorldCupPanelId, insertAfter: boolean) => void;
  onDragStateChange: (panelId: WorldCupPanelId | null) => void;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    active: false,
    started: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    offsetX: 0,
    offsetY: 0,
    rafId: 0,
    ghost: null as HTMLElement | null,
    indicator: null as HTMLElement | null,
    lastTarget: null as HTMLElement | null,
  });

  const clearDragVisuals = () => {
    const state = dragRef.current;
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    slotRef.current?.classList.remove('dragging-source');
    state.lastTarget?.classList.remove('panel-drop-target');
    state.lastTarget = null;
    if (state.ghost) {
      const ghost = state.ghost;
      ghost.style.opacity = '0';
      window.setTimeout(() => ghost.remove(), 140);
      state.ghost = null;
    }
    if (state.indicator) {
      const indicator = state.indicator;
      indicator.style.opacity = '0';
      window.setTimeout(() => indicator.remove(), 140);
      state.indicator = null;
    }
    onDragStateChange(null);
  };

  const findDropTarget = (clientX: number, clientY: number) => {
    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const targetSlot = hit?.closest<HTMLElement>('.wm-worldcup-matrix-cell[data-worldcup-panel-id]') || null;
    if (!targetSlot) return null;
    const targetPanelId = targetSlot.dataset.worldcupPanelId as WorldCupPanelId | undefined;
    if (!targetPanelId || targetPanelId === panelId) return null;
    const rect = targetSlot.getBoundingClientRect();
    return {
      targetSlot,
      targetPanelId,
      insertAfter: clientY > rect.top + rect.height / 2 || (
        Math.abs(clientY - (rect.top + rect.height / 2)) < Math.min(44, rect.height / 4)
        && clientX > rect.left + rect.width / 2
      ),
      rect,
    };
  };

  const updateDropIndicator = (clientX: number, clientY: number) => {
    const state = dragRef.current;
    if (!state.indicator) return;
    const target = findDropTarget(clientX, clientY);
    if (!target) {
      state.indicator.style.opacity = '0';
      state.lastTarget?.classList.remove('panel-drop-target');
      state.lastTarget = null;
      return;
    }
    if (target.targetSlot !== state.lastTarget) {
      state.lastTarget?.classList.remove('panel-drop-target');
      target.targetSlot.classList.add('panel-drop-target');
      state.lastTarget = target.targetSlot;
    }
    state.indicator.style.left = `${target.rect.left}px`;
    state.indicator.style.top = `${target.insertAfter ? target.rect.bottom : target.rect.top - 3}px`;
    state.indicator.style.width = `${target.rect.width}px`;
    state.indicator.style.opacity = '0.92';
  };

  const startDrag = (event: MouseEvent) => {
    if (event.button !== 0 || !slotRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) return;
    if (!target.closest('.wm-panel-header')) return;
    const rect = slotRef.current.getBoundingClientRect();
    dragRef.current = {
      active: true,
      started: false,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      rafId: 0,
      ghost: null,
      indicator: null,
      lastTarget: null,
    };
    event.preventDefault();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const state = dragRef.current;
      if (!state.active || !slotRef.current) return;
      state.lastX = moveEvent.clientX;
      state.lastY = moveEvent.clientY;
      if (!state.started) {
        const dx = Math.abs(moveEvent.clientX - state.startX);
        const dy = Math.abs(moveEvent.clientY - state.startY);
        if (dx < WORLD_CUP_PANEL_DRAG_THRESHOLD && dy < WORLD_CUP_PANEL_DRAG_THRESHOLD) return;
        const sourceRect = slotRef.current.getBoundingClientRect();
        const sourcePanel = slotRef.current.querySelector<HTMLElement>(':scope > .wm-worldcup-panel') || slotRef.current;
        state.started = true;
        onDragStateChange(panelId);
        const ghost = sourcePanel.cloneNode(true) as HTMLElement;
        ghost.querySelectorAll('iframe').forEach((frame) => frame.remove());
        ghost.classList.add('wm-panel-drag-ghost', 'wm-worldcup-drag-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.width = `${sourceRect.width}px`;
        ghost.style.height = `${sourceRect.height}px`;
        ghost.style.left = `${moveEvent.clientX - state.offsetX}px`;
        ghost.style.top = `${moveEvent.clientY - state.offsetY}px`;
        document.body.appendChild(ghost);
        state.ghost = ghost;
        slotRef.current.classList.add('dragging-source');
        const indicator = document.createElement('div');
        indicator.className = 'wm-panel-drop-indicator wm-worldcup-drop-indicator';
        document.body.appendChild(indicator);
        state.indicator = indicator;
      }
      if (state.rafId) window.cancelAnimationFrame(state.rafId);
      state.rafId = window.requestAnimationFrame(() => {
        const latest = dragRef.current;
        if (latest.ghost) {
          latest.ghost.style.left = `${latest.lastX - latest.offsetX}px`;
          latest.ghost.style.top = `${latest.lastY - latest.offsetY}px`;
        }
        updateDropIndicator(latest.lastX, latest.lastY);
        latest.rafId = 0;
      });
    };

    const finishDrag = () => {
      const state = dragRef.current;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', finishDrag);
      document.removeEventListener('keydown', onKeyDown);
      if (state.active && state.started) {
        const targetDrop = findDropTarget(state.lastX, state.lastY);
        if (targetDrop) onMovePanel(panelId, targetDrop.targetPanelId, targetDrop.insertAfter);
      }
      state.active = false;
      state.started = false;
      clearDragVisuals();
    };

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', finishDrag);
      document.removeEventListener('keydown', onKeyDown);
      dragRef.current.active = false;
      dragRef.current.started = false;
      clearDragVisuals();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', finishDrag);
    document.addEventListener('keydown', onKeyDown);
  };

  useEffect(() => clearDragVisuals, []);

  return (
    <div
      ref={slotRef}
      className={`wm-worldcup-matrix-cell wm-worldcup-draggable-cell ${draggingId === panelId ? 'dragging-source' : ''}`}
      data-worldcup-panel-id={panelId}
      onMouseDown={(event) => startDrag(event as MouseEvent)}
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

function coerceSignalTone(tone?: string | null): WorldCupSignalTone {
  if (tone === 'red' || tone === 'gold' || tone === 'blue' || tone === 'purple' || tone === 'gray' || tone === 'green') return tone;
  return 'blue';
}

function runtimeSignalItems(payload: WorldCupDashboardPayload, category: string, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const signals = payload.intelligence?.signals || [];
  return signals
    .filter((item) => item.category === category && (!item.matchId || item.matchId === match?.id))
    .slice(0, 16)
    .map((item, index) => ({
      id: item.id || `${category}-${index}`,
      source: item.source || item.provider || 'LIVE',
      title: item.title || 'World Cup live signal',
      summary: item.summary || 'Runtime feed item from World Cup intelligence provider.',
      age: item.age || payload.intelligence?.generatedAt || 'live',
      tags: (item.tags?.length ? item.tags : [{ label: 'LIVE', tone: 'green' }]).slice(0, 3).map((tag) => ({
        label: tag.label,
        tone: coerceSignalTone(tag.tone),
      })),
      accent: coerceSignalTone(item.accent),
    }));
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

function buildOfficialFactSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null, city: WorldCupDashboardPayload['cities'][number] | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'officialFacts', match);
  if (liveSignals.length) return liveSignals;
  if (!match) return [];
  return [
    {
      id: 'facts-match-centre',
      source: 'FIFA MATCH CENTRE',
      title: `${match.homeTeam} vs ${match.awayTeam}: fixture identity verified`,
      summary: `Match #${match.fifaMatchNumber || '--'} · ${match.group || stageLabel(match.stage)} · ${match.round}.`,
      age: 'seed verified',
      tags: [{ label: 'FACT', tone: 'green' }, { label: 'OFFICIAL', tone: 'blue' }],
      accent: 'green',
    },
    {
      id: 'facts-kickoff',
      source: 'WORLD CUP DESK',
      title: `Kickoff lock: ${match.kickoffBeijing} BJT / ${match.kickoffLocal} local`,
      summary: 'Beijing desk, local desk and venue desk should all reference this same match card.',
      age: 'seed',
      tags: [{ label: 'TIME', tone: 'blue' }, { label: 'VERIFY', tone: 'gray' }],
      accent: 'blue',
    },
    {
      id: 'facts-venue',
      source: 'HOST CITY',
      title: `${match.venue}, ${match.city}`,
      summary: `${city?.countryName || 'Host country'} · capacity ${city?.capacity ? city.capacity.toLocaleString() : 'pending'} · timezone ${city?.timezone || 'local'}.`,
      age: 'venue seed',
      tags: [{ label: 'VENUE', tone: 'gold' }, { label: 'OPS', tone: 'green' }],
      accent: 'gold',
    },
    {
      id: 'facts-team-source',
      source: 'TEAM CHANNELS',
      title: 'National team official channels remain primary roster source',
      summary: 'Team website, X/Instagram and press conference notes are weighted above rumor feeds.',
      age: 'policy',
      tags: [{ label: 'ROSTER', tone: 'purple' }, { label: 'SOURCE', tone: 'gray' }],
      accent: 'purple',
    },
  ];
}

function buildInjurySignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'injuryTracker', match);
  if (liveSignals.length) return liveSignals;
  if (!match) return [];
  const teams = [match.homeTeam, match.awayTeam];
  const rosters = payload.rosters.filter((roster) => teams.includes(roster.team));
  const seedRows = rosters.flatMap((roster) => roster.players.map((player, index) => ({
    id: `injury-${roster.team}-${player.name}`,
    source: roster.team,
    title: player.status === 'injured' ? `${player.name}: injury flag requires confirmation` : `${player.name}: availability watch`,
    summary: `${player.position || 'ALL'} · ${player.club || 'official squad channel'} · source priority: federation / ESPN tracker / club injury note.`,
    age: index ? 'watch' : 'seed',
    tags: [
      { label: player.status === 'injured' ? 'ALERT' : player.status?.toUpperCase() || 'WATCH', tone: player.status === 'injured' ? 'red' : 'gold' },
      { label: 'INJURY', tone: 'red' },
    ],
    accent: player.status === 'injured' ? 'red' : 'gold',
  } satisfies WorldCupSignalItem)));
  const extraRows: WorldCupSignalItem[] = [
    {
      id: 'injury-suspension',
      source: 'DISCIPLINE DESK',
      title: 'Yellow-card accumulation and suspension risk',
      summary: 'Center backs, defensive midfielders and starting goalkeeper availability are highest betting-impact checks.',
      age: 'pre-match',
      tags: [{ label: 'SUSP', tone: 'red' }, { label: 'VERIFY', tone: 'gray' }],
      accent: 'red',
    },
    {
      id: 'injury-press',
      source: 'PRESSER',
      title: 'Coach comments: late fitness and rotation hints',
      summary: 'Press conference phrasing is tracked for "minor discomfort", "trained alone", and "not with group" signals.',
      age: 'pending',
      tags: [{ label: 'COACH', tone: 'blue' }, { label: 'WATCH', tone: 'gold' }],
      accent: 'blue',
    },
  ];
  return [...seedRows, ...extraRows].slice(0, 10);
}

function buildLineupSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'lineupWatch', match);
  if (liveSignals.length) return liveSignals;
  if (!match) return [];
  const rows = [
    ['Flashscore', 'Predicted XI and late starting lineup card', 'Core forwards, goalkeeper and center-back pairing are the first checks.'],
    ['SofaScore', 'Formation drift and player role watch', 'Look for fullback height, pressing line, and midfield balance changes.'],
    ['FotMob', 'Player rating context and probable lineup', 'Recently injured starters and high-minute players are marked for rotation risk.'],
    ['WhoScored', 'Style profile and player matchup notes', 'Weak zones and likely overloads are mapped before kickoff.'],
    ['Official Team Account', 'Confirmed XI override channel', 'Official lineup has priority over all predictive feeds when published.'],
  ] as const;
  return rows.map<WorldCupSignalItem>((row, index) => ({
    id: `lineup-${index}`,
    source: row[0],
    title: `${match.homeTeam} / ${match.awayTeam}: ${row[1]}`,
    summary: row[2],
    age: index === 4 ? 'T-60m' : `${index + 1}h seed`,
    tags: [{ label: index === 4 ? 'CONFIRM' : 'PRED XI', tone: index === 4 ? 'green' : 'purple' }, { label: 'LINEUP', tone: 'blue' }],
    accent: index === 4 ? 'green' : 'purple',
  }));
}

function buildPlayerPoolSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const focusTeams = match ? [match.homeTeam, match.awayTeam] : payload.rosters.slice(0, 4).map((roster) => roster.team);
  return payload.rosters
    .filter((roster) => focusTeams.includes(roster.team))
    .flatMap<WorldCupSignalItem>((roster) => [
      {
        id: `pool-${roster.team}-status`,
        source: roster.team,
        title: `${roster.team}: final roster window`,
        summary: `${roster.players.length || 0} seed entries · official federation squad page remains authority.`,
        age: 'seed',
        tags: [{ label: 'SQUAD', tone: 'green' }, { label: 'OFFICIAL', tone: 'blue' }],
        accent: 'green',
      } satisfies WorldCupSignalItem,
      ...roster.players.map((player) => ({
        id: `pool-${roster.team}-${player.name}`,
        source: player.position || 'PLAYER',
        title: player.name,
        summary: `${player.club || 'federation source'} · ${player.status || 'probable'} · number ${player.number || '--'}.`,
        age: player.status || 'pool',
        tags: [{ label: player.status?.toUpperCase() || 'WATCH', tone: player.status === 'injured' ? 'red' : 'gold' }, { label: 'TEAM', tone: 'gray' }],
        accent: player.status === 'injured' ? 'red' : 'blue',
      } satisfies WorldCupSignalItem)),
    ])
    .slice(0, 12);
}

function buildXgSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'xgModel', match);
  if (liveSignals.length) return liveSignals;
  if (!match) return [];
  const hash = [...match.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const homeXg = 1.05 + (hash % 7) * 0.11;
  const awayXg = 0.92 + (hash % 5) * 0.1;
  const metrics = [
    ['Opta Analyst', 'xG / xGA baseline', `${match.homeTeam} ${homeXg.toFixed(2)} xG · ${match.awayTeam} ${awayXg.toFixed(2)} xG · xGA spread ${(homeXg - awayXg).toFixed(2)}.`],
    ['FBref', 'Shot quality and box-touch pressure', `Box touches and non-penalty shot quality are treated as pre-match tempo signals.`],
    ['StatsBomb', 'Set-piece xG and counter efficiency', 'Dead-ball edge, transition prevention and counter volume are separated from open-play xG.'],
    ['WhoScored', 'PPDA / pressing success', `PPDA watch: high press vulnerability and buildup escape routes for both teams.`],
    ['SofaScore', 'Keeper saves over expected', 'Goalkeeper shot-stopping delta is used as downside protection for totals markets.'],
  ] as const;
  return metrics.map<WorldCupSignalItem>((metric, index) => ({
    id: `xg-${index}`,
    source: metric[0],
    title: metric[1],
    summary: metric[2],
    age: index ? 'model seed' : 'primary',
    tags: [{ label: 'MODEL', tone: 'purple' }, { label: index === 0 ? 'XG' : 'STAT', tone: 'blue' }],
    accent: index === 0 ? 'purple' : 'blue',
  }));
}

function buildTacticalSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'tacticalMatchup', match);
  if (liveSignals.length) return liveSignals;
  if (!match) return [];
  return [
    {
      id: 'tactic-press',
      source: 'THE ATHLETIC',
      title: `${match.homeTeam}: press resistance vs ${match.awayTeam} transition threat`,
      summary: 'High press, rest defense and first-pass escape routes are treated as matchup variables.',
      age: 'analysis seed',
      tags: [{ label: 'MATCHUP', tone: 'gold' }, { label: 'PRESS', tone: 'blue' }],
      accent: 'gold',
    },
    {
      id: 'tactic-wide',
      source: 'TIFO / COACHES VOICE',
      title: 'Wide-channel speed mismatch and fullback height',
      summary: 'Aggressive fullbacks against pace wingers can create more risk than rating models show.',
      age: 'watch',
      tags: [{ label: 'WIDE', tone: 'blue' }, { label: 'RISK', tone: 'red' }],
      accent: 'blue',
    },
    {
      id: 'tactic-setpiece',
      source: 'OPTA ANALYST',
      title: 'Set-piece edge versus aerial defensive profile',
      summary: 'Corners, free kicks and second-ball pressure can move totals and first-goal markets.',
      age: 'model seed',
      tags: [{ label: 'SET PIECE', tone: 'green' }, { label: 'XG', tone: 'purple' }],
      accent: 'green',
    },
    {
      id: 'tactic-block',
      source: 'ZONAL MARKING',
      title: 'Low-block control versus counterattack outlet',
      summary: 'Possession strength does not always imply cover ability when the opponent has fast outlets.',
      age: 'pre-match',
      tags: [{ label: 'TACTIC', tone: 'gold' }, { label: 'COUNTER', tone: 'red' }],
      accent: 'red',
    },
  ];
}

function buildLocalMediaSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'localMedia', match);
  if (liveSignals.length) return liveSignals;
  const teams = match ? [match.homeTeam, match.awayTeam] : ['Argentina', 'Brazil'];
  const homeTeam = teams[0] || 'Home team';
  const awayTeam = teams[1] || 'Away team';
  const media: Array<{
    id: string;
    country: string;
    source: string;
    team: string;
    title: string;
    summary: string;
    age: string;
    tags: WorldCupSignalItem['tags'];
    accent: WorldCupSignalTone;
  }> = [
    {
      id: 'arg-training',
      country: 'ARG',
      source: 'TYC SPORTS / OLE',
      team: homeTeam,
      title: 'Open-session minutes, captain workload and mood check',
      summary: `${homeTeam} local beat watches who trains separately, who leaves drills early, and whether the coach shields a starter.`,
      age: '1h seed',
      tags: [{ label: 'ARG', tone: 'gray' }, { label: 'WATCH', tone: 'blue' }, { label: 'TRAINING', tone: 'green' }],
      accent: 'blue',
    },
    {
      id: 'bra-xi-leak',
      country: 'BRA',
      source: 'GLOBO ESPORTE',
      team: awayTeam,
      title: 'XI tendency leak: fullback height and second striker role',
      summary: `${awayTeam} setup hints are treated as early lineup probability before global desks reprice the match.`,
      age: '2h seed',
      tags: [{ label: 'BRA', tone: 'gray' }, { label: 'LINEUP', tone: 'purple' }, { label: 'RUMOR', tone: 'gold' }],
      accent: 'gold',
    },
    {
      id: 'esp-presser',
      country: 'ESP',
      source: 'MARCA / AS',
      team: homeTeam,
      title: 'Press-room wording: "managed minutes" and late fitness hints',
      summary: 'Spanish desk flags coach language that often precedes rotation, bench protection, or reduced match load.',
      age: '3h seed',
      tags: [{ label: 'ESP', tone: 'gray' }, { label: 'PRESSER', tone: 'blue' }, { label: 'FITNESS', tone: 'gold' }],
      accent: 'blue',
    },
    {
      id: 'fra-medical',
      country: 'FRA',
      source: "L'EQUIPE",
      team: awayTeam,
      title: 'Medical-room watch: knock recovery and training restrictions',
      summary: `${awayTeam} injury wording is cross-checked against club notes, federation photos and final media availability.`,
      age: '4h seed',
      tags: [{ label: 'FRA', tone: 'gray' }, { label: 'INJURY', tone: 'red' }, { label: 'VERIFY', tone: 'blue' }],
      accent: 'red',
    },
    {
      id: 'ger-camp',
      country: 'GER',
      source: 'KICKER / BILD',
      team: homeTeam,
      title: 'Camp status: closed training shape and selection dispute',
      summary: 'German local reports are useful when tactical shape leaks before official team sheets are released.',
      age: '5h seed',
      tags: [{ label: 'GER', tone: 'gray' }, { label: 'CAMP', tone: 'green' }, { label: 'TACTIC', tone: 'gold' }],
      accent: 'green',
    },
    {
      id: 'eng-confirm',
      country: 'ENG',
      source: 'BBC / SKY / THE ATHLETIC',
      team: awayTeam,
      title: 'Confirmed squad context and trusted journalist override',
      summary: 'High-confidence English sources can override weaker social chatter when roster or availability conflicts appear.',
      age: '6h seed',
      tags: [{ label: 'ENG', tone: 'gray' }, { label: 'SOURCE', tone: 'blue' }, { label: 'CONFIRM', tone: 'green' }],
      accent: 'green',
    },
    {
      id: 'mex-venue',
      country: 'MEX',
      source: 'MEDIOTIEMPO / TUDN',
      team: homeTeam,
      title: 'Host-city signal: venue access, turf note and crowd heat',
      summary: match ? `${match.city} local desk watches transport load, field condition and fan-flow disruption before kickoff.` : 'Local venue desk tracks access, pitch and crowd-flow risk.',
      age: 'live seed',
      tags: [{ label: 'MEX', tone: 'gray' }, { label: 'VENUE', tone: 'blue' }, { label: 'OPS', tone: 'gold' }],
      accent: 'blue',
    },
    {
      id: 'rsa-camp',
      country: 'RSA',
      source: 'SOCCER LADUMA',
      team: awayTeam,
      title: 'Camp mood and travel recovery after media day',
      summary: `${awayTeam} local coverage is watched for morale, late travel load and whether senior players front media duties.`,
      age: '7h seed',
      tags: [{ label: 'RSA', tone: 'gray' }, { label: 'MOOD', tone: 'gold' }, { label: 'TRAVEL', tone: 'blue' }],
      accent: 'gold',
    },
    {
      id: 'kor-training',
      country: 'KOR',
      source: 'NAVER SPORTS',
      team: homeTeam,
      title: 'Training tempo: pressing drills and striker rotation',
      summary: 'Local-language training descriptions can expose whether a side is preparing to press, sit deeper or rotate forwards.',
      age: '8h seed',
      tags: [{ label: 'KOR', tone: 'gray' }, { label: 'TACTIC', tone: 'purple' }, { label: 'WATCH', tone: 'blue' }],
      accent: 'purple',
    },
    {
      id: 'qat-heat',
      country: 'QAT',
      source: 'AL KASS / BEIN',
      team: awayTeam,
      title: 'Heat adaptation and late-session workload note',
      summary: 'Regional desks are monitored for climate adaptation, hydration breaks and lower-tempo match expectation signals.',
      age: '9h seed',
      tags: [{ label: 'QAT', tone: 'gray' }, { label: 'WEATHER', tone: 'blue' }, { label: 'TEMPO', tone: 'gold' }],
      accent: 'blue',
    },
    {
      id: 'latam-market',
      country: 'LATAM',
      source: 'ESPN DEPORTES',
      team: homeTeam,
      title: 'Public sentiment swing around star availability',
      summary: 'Spanish-language social/news pickup is tracked when a star-player rumor may move liquidity or fan-heavy markets.',
      age: '10h seed',
      tags: [{ label: 'LATAM', tone: 'gray' }, { label: 'MARKET', tone: 'purple' }, { label: 'STAR', tone: 'gold' }],
      accent: 'purple',
    },
    {
      id: 'wire-crosscheck',
      country: 'WIRE',
      source: 'LOCAL CROSSCHECK',
      team: `${homeTeam} / ${awayTeam}`,
      title: 'Two-source rule before promoting rumor to alert',
      summary: 'A local signal only becomes ALERT after an official channel, trusted beat reporter or lineup service confirms it.',
      age: 'policy',
      tags: [{ label: 'RULE', tone: 'gray' }, { label: 'VERIFY', tone: 'blue' }, { label: 'ALERT', tone: 'red' }],
      accent: 'red',
    },
  ];
  return media.map<WorldCupSignalItem>((item) => ({
    id: `local-media-${item.id}`,
    source: item.source,
    title: `${item.team}: ${item.title}`,
    summary: item.summary,
    age: item.age,
    tags: item.tags,
    accent: item.accent,
  }));
}

function buildRefVenueSignals(payload: WorldCupDashboardPayload, match: WorldCupMatch | null): WorldCupSignalItem[] {
  const liveSignals = runtimeSignalItems(payload, 'refVenue', match);
  if (liveSignals.length) return liveSignals;
  if (!match) return [];
  const weather = payload.weather.find((item) => item.cityId === match.cityId);
  return [
    {
      id: 'ref-weather',
      source: 'WEATHER DESK',
      title: `${match.city}: ${weather?.current.condition || 'conditions'} at venue window`,
      summary: `${weather?.current.tempC ?? '--'}C · wind ${weather?.current.windKph ?? '--'} kph · rain ${weather?.current.precipitationProbability ?? 0}% · pitch pace watch.`,
      age: 'live seed',
      tags: [{ label: 'WEATHER', tone: 'blue' }, { label: /storm|rain/i.test(weather?.current.condition || '') ? 'ALERT' : 'WATCH', tone: /storm|rain/i.test(weather?.current.condition || '') ? 'red' : 'gold' }],
      accent: 'blue',
    },
    {
      id: 'ref-referee',
      source: 'REFEREE DESK',
      title: 'Referee assignment pending: cards, fouls and penalty tendency',
      summary: 'Card profile, foul threshold and VAR usage are tracked for totals, bookings and tempo.',
      age: 'pending',
      tags: [{ label: 'REF', tone: 'gold' }, { label: 'CARDS', tone: 'red' }],
      accent: 'gold',
    },
    {
      id: 'ref-pitch',
      source: 'VENUE OPS',
      title: `${match.venue}: grass, roof and stadium operations`,
      summary: 'Pitch speed, surface condition, roof status and local operations can affect tempo and passing risk.',
      age: 'venue seed',
      tags: [{ label: 'PITCH', tone: 'green' }, { label: 'OPS', tone: 'gray' }],
      accent: 'green',
    },
    {
      id: 'ref-travel',
      source: 'LOCAL OPS',
      title: 'Travel, crowd flow and security perimeter',
      summary: 'Ingress timing, airport load and fan movement are tracked as disruption context.',
      age: 'ops seed',
      tags: [{ label: 'TRAVEL', tone: 'blue' }, { label: 'SECURITY', tone: 'red' }],
      accent: 'red',
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
  const news = useMemo(() => {
    const runtimeNews = payload?.news || [];
    const contentNews = filterWorldCupNews(latestContent, selectedMatch);
    const seen = new Set<string>();
    return [...runtimeNews, ...contentNews].filter((item) => {
      const key = `${item.source}:${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 24);
  }, [latestContent, payload?.news, selectedMatch]);

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
  const plannedMatchTotal = payload.cities.reduce((sum, city) => sum + (WORLD_CUP_HOST_MATCH_COUNTS[city.id] || 0), 0);
  const displayOdds = expandOddsSnapshots(selectedOdds.length ? selectedOdds : payload.odds, selectedMatch);
  const matchSignals = buildMatchSignals(selectedMatch, selectedMarkets);
  const hostOpsSignals = buildHostOpsSignals(payload, selectedCity.id);
  const marketSignals = buildMarketSignals(selectedMarkets, selectedMatch);
  const squadSignals = buildSquadSignals(payload, selectedMatch);
  const oddsSignals = buildOddsSignals(displayOdds, selectedMatch);
  const riskSignals = buildRiskSignals(payload, selectedMatch);
  const broadcastSignals = buildBroadcastSignals(selectedMatch);
  const officialFactSignals = buildOfficialFactSignals(payload, selectedMatch, selectedCity);
  const injurySignals = buildInjurySignals(payload, selectedMatch);
  const lineupSignals = buildLineupSignals(payload, selectedMatch);
  const playerPoolSignals = buildPlayerPoolSignals(payload, selectedMatch);
  const xgSignals = buildXgSignals(payload, selectedMatch);
  const tacticalSignals = buildTacticalSignals(payload, selectedMatch);
  const localMediaSignals = buildLocalMediaSignals(payload, selectedMatch);
  const refVenueSignals = buildRefVenueSignals(payload, selectedMatch);
  const terminalMetrics = [
    { label: 'next_kickoff', value: formatCountdown(nextMatch, now), meta: nextMatch ? `${nextMatch.homeTeam} vs ${nextMatch.awayTeam}` : 'schedule complete' },
    { label: 'selected_city', value: selectedCity.city, meta: `${selectedCity.country} · ${selectedCityMatchCount} matches` },
    { label: 'match_count', value: String(Math.max(payload.matches.length, plannedMatchTotal)), meta: `${payload.cities.length} host cities` },
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
    'official-facts': <SignalFeedPanel title="OFFICIAL FACTS" badge="SEED" count={officialFactSignals.length} items={officialFactSignals} className="wm-worldcup-official-panel" />,
    'injury-tracker': <SignalFeedPanel title="INJURY TRACKER" badge="SEED" count={injurySignals.length} items={injurySignals} className="wm-worldcup-injury-panel" />,
    'lineup-watch': <SignalFeedPanel title="LINEUP WATCH" badge="SEED" count={lineupSignals.length} items={lineupSignals} className="wm-worldcup-lineup-panel" />,
    'player-pool': <SignalFeedPanel title="PLAYER POOL" badge="SEED" count={playerPoolSignals.length} items={playerPoolSignals} className="wm-worldcup-player-pool-panel" />,
    'xg-model': <SignalFeedPanel title="XG MODEL" badge="SEED" count={xgSignals.length} items={xgSignals} className="wm-worldcup-xg-panel" />,
    'tactical-matchup': <SignalFeedPanel title="TACTICAL MATCHUP" badge="SEED" count={tacticalSignals.length} items={tacticalSignals} className="wm-worldcup-tactical-panel" />,
    'local-media': <SignalFeedPanel title="LOCAL MEDIA" badge="SEED" count={localMediaSignals.length} items={localMediaSignals} className="wm-worldcup-local-media-panel" />,
    'ref-venue': <SignalFeedPanel title="REF VENUE" badge="SEED" count={refVenueSignals.length} items={refVenueSignals} className="wm-worldcup-ref-venue-panel" />,
  };
  const orderedPanels = [...panelOrder, ...WORLD_CUP_PANEL_ORDER.filter((id) => !panelOrder.includes(id))]
    .filter((id, index, array) => array.indexOf(id) === index);
  const movePanel = (draggedId: WorldCupPanelId, targetId: WorldCupPanelId, insertAfter: boolean) => {
    setPanelOrder((current) => reorderWorldCupPanels(current, draggedId, targetId, insertAfter));
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
            <span className="wm-status-chip">WORLD CUP · PRE-TOURNAMENT</span>
            <div className="wm-map-clock">{formatBjtClock(now)} BJT</div>
            <span className="wm-map-next-chip">
              {nextCity && nextMatch
                ? `NEXT · ${nextCity.city} · M#${nextMatch.fifaMatchNumber || '--'} · ${formatCountdown(nextMatch, now)}`
                : 'NEXT · --'}
            </span>
          </div>
        </div>
        <WorldCupMap
          cities={payload.cities}
          matches={payload.matches}
          weather={payload.weather}
          marketGroups={marketGroups}
          odds={payload.odds}
          rosters={payload.rosters}
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
            onDragStateChange={setDraggingPanelId}
            onMovePanel={movePanel}
          >
            {worldCupPanels[panelId]}
          </WorldCupPanelSlot>
        ))}
      </section>
    </main>
  );
}
