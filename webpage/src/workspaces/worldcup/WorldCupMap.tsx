import { useMemo } from 'preact/hooks';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-110m.json';
import type { WorldCupMatch, WorldCupVenueCity } from './types';

type WorldCupMapProps = {
  cities: WorldCupVenueCity[];
  matches: WorldCupMatch[];
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

export function WorldCupMap({ cities, matches, selectedCityId, selectedMatchId, onSelectCity }: WorldCupMapProps) {
  const { projection, transform, world } = useMemo(() => buildProjection(), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;

  const cityPoints = useMemo(() => cities.map((city) => {
    const projected = projection([city.longitude, city.latitude]);
    return projected ? {
      city,
      x: projected[0],
      y: projected[1],
      status: cityStatus(city.id, matches),
      count: matches.filter((match) => match.cityId === city.id).length,
    } : null;
  }).filter(Boolean) as Array<{ city: WorldCupVenueCity; x: number; y: number; status: string; count: number }>, [cities, matches, projection]);

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
            return (
              <g
                className={`wm-worldcup-city-point ${point.status} ${selected ? 'selected' : ''}`}
                key={point.city.id}
                role="button"
                tabIndex={0}
                transform={`translate(${point.x} ${point.y})`}
                onClick={() => onSelectCity(point.city.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectCity(point.city.id);
                  }
                }}
              >
                <circle className="halo" r={selected ? 20 : 13} />
                <circle className="dot" r={selected ? 6 : 4.4} />
                <text x="9" y="-8">{point.city.city}</text>
                <text className="meta" x="9" y="6">{statusLabel(point.status)} · {point.count}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="wm-worldcup-map-legend">
        <span><i className="scheduled" /> UPCOMING</span>
        <span><i className="live" /> LIVE</span>
        <span><i className="finished" /> FINISHED</span>
      </div>
    </div>
  );
}
