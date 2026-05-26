import { useMemo, useState } from 'preact/hooks';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-110m.json';
import type { WorldCupCityWeather, WorldCupMatch, WorldCupVenueCity } from './types';

type WorldCupMapProps = {
  cities: WorldCupVenueCity[];
  matches: WorldCupMatch[];
  weather: WorldCupCityWeather[];
  nextMatch: WorldCupMatch | null;
  selectedCityId: string | null;
  selectedMatchId: string | null;
  onSelectCity: (cityId: string) => void;
};

const VIEWBOX_WIDTH = 1280;
const VIEWBOX_HEIGHT = 620;

function buildProjection() {
  const projection = geoMercator();
  const world = feature(countriesAtlas as any, (countriesAtlas as any).objects.countries) as any;
  const americasViewport = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-171, 74],
        [-22, 74],
        [-22, -12],
        [-171, -12],
        [-171, 74],
      ]],
    },
    properties: {},
  } as any;
  projection.fitExtent([[0, 0], [VIEWBOX_WIDTH, VIEWBOX_HEIGHT]], americasViewport);
  return {
    projection,
    world,
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

function matchTitle(match: WorldCupMatch) {
  return `${match.homeTeam} vs ${match.awayTeam}`;
}

function shortKickoff(match: WorldCupMatch) {
  return match.kickoffLocal.replace(',', ' ·');
}

export function WorldCupMap({ cities, matches, weather, nextMatch, selectedCityId, selectedMatchId, onSelectCity }: WorldCupMapProps) {
  const [hoverCityId, setHoverCityId] = useState<string | null>(null);
  const { projection, world } = useMemo(() => buildProjection(), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;
  const nextCityId = nextMatch?.cityId || null;

  const matchCountByCity = useMemo(() => {
    const counts = new Map<string, number>();
    matches.forEach((match) => counts.set(match.cityId, (counts.get(match.cityId) || 0) + 1));
    return counts;
  }, [matches]);

  const weatherByCity = useMemo(() => {
    const cityWeather = new Map<string, WorldCupCityWeather>();
    weather.forEach((item) => cityWeather.set(item.cityId, item));
    return cityWeather;
  }, [weather]);

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
  const activeWeather = activePoint ? weatherByCity.get(activePoint.city.id) || null : null;

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
        <g>
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
                <circle className="halo" r={selected ? 54 : next ? 42 : 28} />
                <circle className="dot" r={selected ? 10 : 7.5} />
                {showLabel ? (
                  <>
                    <text x="17" y="-9">{compactCityName(point.city.city)}</text>
                    <text className="meta" x="17" y="10">{statusLabel(point.status)} · {point.count}</text>
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
          <div className="wm-worldcup-city-card-stats">
            <span><b>{activePoint.count}</b><small>matches</small></span>
            <span><b>{activePoint.city.capacity ? `${Math.round(activePoint.city.capacity / 1000)}k` : '--'}</b><small>capacity</small></span>
            <span><b>{activeWeather ? `${activeWeather.current.tempC}°` : '--'}</b><small>{activeWeather?.current.condition || 'weather'}</small></span>
            <span><b>{activeWeather?.current.windKph ? `${activeWeather.current.windKph}` : '--'}</b><small>wind kph</small></span>
          </div>
          {nextCityMatch ? (
            <section className="wm-worldcup-city-card-next">
              <span>NEXT MATCH</span>
              <strong>{matchTitle(nextCityMatch)}</strong>
              <em>#{nextCityMatch.fifaMatchNumber || '--'} · {shortKickoff(nextCityMatch)} · {nextCityMatch.status.toUpperCase()}</em>
            </section>
          ) : null}
          {activeWeather ? (
            <section className="wm-worldcup-city-card-forecast">
              {activeWeather.forecast.slice(0, 3).map((item) => (
                <span key={item.date}>
                  <b>{item.date.slice(5)}</b>
                  <small>{item.lowC}°/{item.highC}° · {item.condition}</small>
                </span>
              ))}
            </section>
          ) : null}
          <section className="wm-worldcup-city-card-matches">
            {activeMatches.slice(0, 4).map((match) => (
              <p key={match.id}>
                <b>#{match.fifaMatchNumber || '--'}</b>
                <span>{matchTitle(match)}</span>
                <em>{shortKickoff(match)}</em>
              </p>
            ))}
          </section>
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
