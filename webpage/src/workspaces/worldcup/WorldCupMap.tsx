import { useMemo, useState } from 'preact/hooks';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-110m.json';
import type { WorldCupMatch, WorldCupVenueCity } from './types';

type WorldCupMapProps = {
  cities: WorldCupVenueCity[];
  matches: WorldCupMatch[];
  nextMatch: WorldCupMatch | null;
  selectedCityId: string | null;
  selectedMatchId: string | null;
  onSelectCity: (cityId: string) => void;
};

const VIEWBOX_WIDTH = 1280;
const VIEWBOX_HEIGHT = 620;

function buildProjection() {
  const projection = geoNaturalEarth1();
  const world = feature(countriesAtlas as any, (countriesAtlas as any).objects.countries) as any;
  projection.fitExtent([[18, 18], [VIEWBOX_WIDTH - 18, VIEWBOX_HEIGHT - 18]], world);
  const focus = projection([-97, 39]) || [VIEWBOX_WIDTH / 2, VIEWBOX_HEIGHT / 2];
  const zoom = 2.38;
  return {
    projection,
    world,
    transform: `translate(${(VIEWBOX_WIDTH / 2 - focus[0] * zoom).toFixed(2)} ${(VIEWBOX_HEIGHT / 2 - focus[1] * zoom).toFixed(2)}) scale(${zoom})`,
  };
}

function cityStatus(cityId: string, matches: WorldCupMatch[]) {
  const cityMatches = matches.filter((match) => match.cityId === cityId);
  if (cityMatches.some((match) => match.status === 'live')) return 'live';
  if (cityMatches.some((match) => match.status === 'scheduled')) return 'scheduled';
  return 'finished';
}

function statusLabel(status: string) {
  if (status === 'live') return 'LIVE';
  if (status === 'scheduled') return 'UPCOMING';
  return 'DONE';
}

function compactCityName(city: string) {
  return city.replace(' / ', '/').replace(' Bay Area', '').replace(' Gardens', '');
}

export function WorldCupMap({ cities, matches, nextMatch, selectedCityId, selectedMatchId, onSelectCity }: WorldCupMapProps) {
  const [hoverCityId, setHoverCityId] = useState<string | null>(null);
  const { projection, transform, world } = useMemo(() => buildProjection(), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;
  const nextCityId = nextMatch?.cityId || null;

  const matchCountByCity = useMemo(() => {
    const counts = new Map<string, number>();
    matches.forEach((match) => counts.set(match.cityId, (counts.get(match.cityId) || 0) + 1));
    return counts;
  }, [matches]);

  const importantCityIds = useMemo(() => {
    const ids = new Set<string>(['mexico-city', 'new-york-new-jersey', 'dallas', 'los-angeles']);
    if (nextCityId) ids.add(nextCityId);
    if (selectedCityId) ids.add(selectedCityId);
    return ids;
  }, [nextCityId, selectedCityId]);

  const cityPoints = useMemo(() => cities.map((city) => {
    const projected = projection([city.longitude, city.latitude]);
    return projected ? {
      city,
      x: projected[0],
      y: projected[1],
      status: cityStatus(city.id, matches),
      count: matchCountByCity.get(city.id) || 0,
    } : null;
  }).filter(Boolean) as Array<{ city: WorldCupVenueCity; x: number; y: number; status: string; count: number }>, [cities, matchCountByCity, matches, projection]);

  const hoverPoint = cityPoints.find((point) => point.city.id === hoverCityId) || null;
  const activePoint = cityPoints.find((point) => point.city.id === selectedCityId)
    || cityPoints.find((point) => point.city.id === selectedMatch?.cityId)
    || cityPoints.find((point) => point.city.id === nextCityId)
    || null;
  const activeMatches = activePoint ? matches.filter((match) => match.cityId === activePoint.city.id) : [];
  const nextCityMatch = activePoint ? activeMatches.find((match) => match.id === nextMatch?.id) || activeMatches.find((match) => match.status === 'scheduled') : null;

  return (
    <div className="wm-worldcup-map">
      <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-label="2026 World Cup host map">
        <defs>
          <linearGradient id="wmWcSea" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#061119" />
            <stop offset="100%" stopColor="#020607" />
          </linearGradient>
          <radialGradient id="wmWcPulse">
            <stop offset="0%" stopColor="rgba(57,255,115,.52)" />
            <stop offset="100%" stopColor="rgba(57,255,115,0)" />
          </radialGradient>
        </defs>
        <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#wmWcSea)" />
        <g transform={transform}>
          <path className="wm-worldcup-land" d={path(world) || ''} />
          <path className="wm-worldcup-graticule" d="M0 0" />
          {cityPoints.map((point) => {
            const selected = point.city.id === selectedCityId || point.city.id === selectedMatch?.cityId;
            const hovered = point.city.id === hoverCityId;
            const next = point.city.id === nextCityId;
            const important = importantCityIds.has(point.city.id);
            const showLabel = hovered || selected || important;
            return (
              <g
                className={`wm-worldcup-city-point ${point.status} ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${next ? 'next' : ''} ${important ? 'important' : ''}`}
                key={point.city.id}
                role="button"
                tabIndex={0}
                transform={`translate(${point.x} ${point.y})`}
                onClick={() => onSelectCity(point.city.id)}
                onMouseEnter={() => setHoverCityId(point.city.id)}
                onMouseLeave={() => setHoverCityId((current) => (current === point.city.id ? null : current))}
                onFocus={() => setHoverCityId(point.city.id)}
                onBlur={() => setHoverCityId((current) => (current === point.city.id ? null : current))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectCity(point.city.id);
                  }
                }}
              >
                <circle className="halo" r={selected ? 20 : 13} />
                <circle className="dot" r={selected ? 6 : 4.4} />
                {showLabel ? (
                  <>
                    <text x="9" y="-8">{compactCityName(point.city.city)}</text>
                    <text className="meta" x="9" y="6">{statusLabel(point.status)} · {point.count}</text>
                  </>
                ) : null}
              </g>
            );
          })}
          {hoverPoint ? (
            <g className="wm-worldcup-map-tooltip" transform={`translate(${hoverPoint.x + 16} ${hoverPoint.y - 58})`}>
              <rect width="176" height="54" rx="4" />
              <text x="10" y="17">{hoverPoint.city.city}</text>
              <text className="meta" x="10" y="33">{hoverPoint.city.countryName} · {hoverPoint.city.venue}</text>
              <text className="accent" x="10" y="48">{hoverPoint.count} matches · {statusLabel(hoverPoint.status)}</text>
            </g>
          ) : null}
        </g>
      </svg>
      {activePoint ? (
        <aside className="wm-worldcup-city-card">
          <span>SELECTED HOST CITY</span>
          <strong>{activePoint.city.city}</strong>
          <em>{activePoint.city.venue} · {activePoint.city.countryName}</em>
          <div>
            <b>{activePoint.count}</b>
            <small>matches</small>
            <b>{activePoint.city.capacity ? `${Math.round(activePoint.city.capacity / 1000)}k` : '--'}</b>
            <small>capacity</small>
          </div>
          {nextCityMatch ? <p>{nextCityMatch.homeTeam} vs {nextCityMatch.awayTeam} · {nextCityMatch.kickoffLocal}</p> : null}
        </aside>
      ) : null}
      <div className="wm-worldcup-map-legend">
        <span><i className="scheduled" /> UPCOMING</span>
        <span><i className="live" /> LIVE</span>
        <span><i className="finished" /> FINISHED</span>
      </div>
    </div>
  );
}
