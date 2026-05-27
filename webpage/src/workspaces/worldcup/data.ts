import type { ContentItem, MarketGroupItem } from '@/types';
import type {
  WorldCupCityWeather,
  WorldCupDashboardPayload,
  WorldCupMatch,
  WorldCupNewsItem,
  WorldCupOddsSnapshot,
  WorldCupPolymarketMarket,
  WorldCupStage,
  WorldCupTeamRoster,
  WorldCupVenueCity,
} from './types';

const DATA_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
const MS_PER_MINUTE = 60 * 1000;

export const WORLD_CUP_CITIES: WorldCupVenueCity[] = [
  { id: 'atlanta', city: 'Atlanta', country: 'US', countryName: 'United States', venue: 'Mercedes-Benz Stadium', latitude: 33.7554, longitude: -84.4008, timezone: 'America/New_York', capacity: 71000 },
  { id: 'boston', city: 'Boston / Foxborough', country: 'US', countryName: 'United States', venue: 'Gillette Stadium', latitude: 42.0909, longitude: -71.2643, timezone: 'America/New_York', capacity: 65878 },
  { id: 'dallas', city: 'Dallas / Arlington', country: 'US', countryName: 'United States', venue: 'AT&T Stadium', latitude: 32.7473, longitude: -97.0945, timezone: 'America/Chicago', capacity: 80000 },
  { id: 'houston', city: 'Houston', country: 'US', countryName: 'United States', venue: 'NRG Stadium', latitude: 29.6847, longitude: -95.4107, timezone: 'America/Chicago', capacity: 72220 },
  { id: 'kansas-city', city: 'Kansas City', country: 'US', countryName: 'United States', venue: 'Arrowhead Stadium', latitude: 39.0489, longitude: -94.4839, timezone: 'America/Chicago', capacity: 76416 },
  { id: 'los-angeles', city: 'Los Angeles / Inglewood', country: 'US', countryName: 'United States', venue: 'SoFi Stadium', latitude: 33.9535, longitude: -118.3392, timezone: 'America/Los_Angeles', capacity: 70240 },
  { id: 'miami', city: 'Miami Gardens', country: 'US', countryName: 'United States', venue: 'Hard Rock Stadium', latitude: 25.958, longitude: -80.2389, timezone: 'America/New_York', capacity: 65326 },
  { id: 'new-york-new-jersey', city: 'New York / New Jersey', country: 'US', countryName: 'United States', venue: 'MetLife Stadium', latitude: 40.8135, longitude: -74.0745, timezone: 'America/New_York', capacity: 82500 },
  { id: 'philadelphia', city: 'Philadelphia', country: 'US', countryName: 'United States', venue: 'Lincoln Financial Field', latitude: 39.9008, longitude: -75.1675, timezone: 'America/New_York', capacity: 67594 },
  { id: 'san-francisco', city: 'San Francisco Bay Area', country: 'US', countryName: 'United States', venue: "Levi's Stadium", latitude: 37.403, longitude: -121.97, timezone: 'America/Los_Angeles', capacity: 68500 },
  { id: 'seattle', city: 'Seattle', country: 'US', countryName: 'United States', venue: 'Lumen Field', latitude: 47.5952, longitude: -122.3316, timezone: 'America/Los_Angeles', capacity: 69000 },
  { id: 'guadalajara', city: 'Guadalajara / Zapopan', country: 'MX', countryName: 'Mexico', venue: 'Estadio Akron', latitude: 20.6818, longitude: -103.4623, timezone: 'America/Mexico_City', capacity: 49850 },
  { id: 'mexico-city', city: 'Mexico City', country: 'MX', countryName: 'Mexico', venue: 'Estadio Azteca', latitude: 19.3029, longitude: -99.1505, timezone: 'America/Mexico_City', capacity: 87523 },
  { id: 'monterrey', city: 'Monterrey / Guadalupe', country: 'MX', countryName: 'Mexico', venue: 'Estadio BBVA', latitude: 25.6683, longitude: -100.2446, timezone: 'America/Monterrey', capacity: 53500 },
  { id: 'toronto', city: 'Toronto', country: 'CA', countryName: 'Canada', venue: 'BMO Field', latitude: 43.6332, longitude: -79.4186, timezone: 'America/Toronto', capacity: 45000 },
  { id: 'vancouver', city: 'Vancouver', country: 'CA', countryName: 'Canada', venue: 'BC Place', latitude: 49.2767, longitude: -123.1119, timezone: 'America/Vancouver', capacity: 54500 },
];

const GROUND_TO_CITY_ID: Record<string, string> = {
  Atlanta: 'atlanta',
  'Boston (Foxborough)': 'boston',
  'Dallas (Arlington)': 'dallas',
  Houston: 'houston',
  'Kansas City': 'kansas-city',
  'Los Angeles (Inglewood)': 'los-angeles',
  'Miami (Miami Gardens)': 'miami',
  'New York/New Jersey (East Rutherford)': 'new-york-new-jersey',
  Philadelphia: 'philadelphia',
  'San Francisco Bay Area (Santa Clara)': 'san-francisco',
  Seattle: 'seattle',
  'Guadalajara (Zapopan)': 'guadalajara',
  'Mexico City': 'mexico-city',
  'Monterrey (Guadalupe)': 'monterrey',
  Toronto: 'toronto',
  Vancouver: 'vancouver',
};

const FALLBACK_SOURCE_MATCHES = [
  { round: 'Matchday 1', date: '2026-06-11', time: '13:00 UTC-6', team1: 'Mexico', team2: 'South Africa', group: 'Group A', ground: 'Mexico City' },
  { round: 'Matchday 1', date: '2026-06-11', time: '20:00 UTC-6', team1: 'South Korea', team2: 'Czech Republic', group: 'Group A', ground: 'Guadalajara (Zapopan)' },
  { round: 'Matchday 2', date: '2026-06-12', time: '15:00 UTC-4', team1: 'Canada', team2: 'Bosnia & Herzegovina', group: 'Group B', ground: 'Toronto' },
  { round: 'Matchday 2', date: '2026-06-12', time: '18:00 UTC-7', team1: 'United States', team2: 'Paraguay', group: 'Group D', ground: 'Los Angeles (Inglewood)' },
  { round: 'Matchday 3', date: '2026-06-13', time: '12:00 UTC-7', team1: 'Qatar', team2: 'Switzerland', group: 'Group B', ground: 'San Francisco Bay Area (Santa Clara)' },
  { round: 'Matchday 3', date: '2026-06-13', time: '18:00 UTC-4', team1: 'Brazil', team2: 'Morocco', group: 'Group C', ground: 'New York/New Jersey (East Rutherford)' },
  { round: 'Matchday 3', date: '2026-06-13', time: '21:00 UTC-4', team1: 'Haiti', team2: 'Scotland', group: 'Group C', ground: 'Boston (Foxborough)' },
  { round: 'Matchday 3', date: '2026-06-13', time: '21:00 UTC-7', team1: 'Australia', team2: 'Turkey', group: 'Group D', ground: 'Vancouver' },
  { round: 'Matchday 4', date: '2026-06-14', time: '12:00 UTC-5', team1: 'Germany', team2: 'Curaçao', group: 'Group E', ground: 'Houston' },
  { round: 'Matchday 4', date: '2026-06-14', time: '16:00 UTC-4', team1: 'Netherlands', team2: 'Japan', group: 'Group E', ground: 'Atlanta' },
  { round: 'Matchday 4', date: '2026-06-14', time: '18:00 UTC-6', team1: 'Ivory Coast', team2: 'Ecuador', group: 'Group F', ground: 'Monterrey (Guadalupe)' },
  { round: 'Matchday 4', date: '2026-06-14', time: '19:00 UTC-7', team1: 'Sweden', team2: 'Tunisia', group: 'Group F', ground: 'Seattle' },
  { round: 'Matchday 5', date: '2026-06-15', time: '12:00 UTC-4', team1: 'Spain', team2: 'Cape Verde', group: 'Group G', ground: 'Philadelphia' },
  { round: 'Matchday 5', date: '2026-06-15', time: '17:00 UTC-5', team1: 'Belgium', team2: 'Egypt', group: 'Group G', ground: 'Dallas (Arlington)' },
  { round: 'Matchday 5', date: '2026-06-15', time: '18:00 UTC-5', team1: 'Saudi Arabia', team2: 'Uruguay', group: 'Group H', ground: 'Kansas City' },
  { round: 'Final', date: '2026-07-19', time: '15:00 UTC-4', team1: 'W101', team2: 'W102', ground: 'New York/New Jersey (East Rutherford)' },
];

function parseKickoff(source: { date: string; time: string }) {
  const match = /^(\d{1,2}):(\d{2})\s+UTC([+-]\d{1,2})(?::?(\d{2}))?$/.exec(source.time);
  if (!match) return new Date(`${source.date}T00:00:00Z`);
  const [, hour = '00', minute = '00', offsetHours = '+0', offsetMinutes = '00'] = match;
  const utcMs = Date.UTC(
    Number(source.date.slice(0, 4)),
    Number(source.date.slice(5, 7)) - 1,
    Number(source.date.slice(8, 10)),
    Number(hour),
    Number(minute),
  );
  const sign = offsetHours.startsWith('-') ? -1 : 1;
  const offsetMs = sign * (Math.abs(Number(offsetHours)) * 60 + Number(offsetMinutes)) * MS_PER_MINUTE;
  return new Date(utcMs - offsetMs);
}

function stageFromRound(round = '', group = ''): WorldCupStage {
  const text = `${round} ${group}`.toLowerCase();
  if (text.includes('final') && text.includes('third')) return 'third_place';
  if (text.includes('final')) return 'final';
  if (text.includes('semi')) return 'semifinal';
  if (text.includes('quarter')) return 'quarterfinal';
  if (text.includes('round of 16')) return 'round16';
  if (text.includes('round of 32')) return 'round32';
  return 'group';
}

function formatInTimeZone(date: Date, timeZone: string, withDate = true) {
  return new Intl.DateTimeFormat('en-GB', {
    month: withDate ? 'short' : undefined,
    day: withDate ? '2-digit' : undefined,
    weekday: withDate ? 'short' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

function normalizePlaceholderTeam(team?: string) {
  if (!team) return 'TBD';
  const winner = /^W(\d+)$/.exec(team);
  if (winner) return `Winner M${winner[1]}`;
  const loser = /^L(\d+)$/.exec(team);
  if (loser) return `Loser M${loser[1]}`;
  const groupRank = /^([123])([A-L])$/.exec(team);
  if (groupRank) return `${groupRank[2]}${groupRank[1]}`;
  const thirdPlace = /^3([A-L](?:\/[A-L])*)$/.exec(team);
  if (thirdPlace) return `3rd ${thirdPlace[1]}`;
  return team;
}

export function normalizeWorldCupMatches(matches: any[], marketGroups: MarketGroupItem[] = []): WorldCupMatch[] {
  const linkedText = marketGroups.map((group) => `${group.title} ${group.slug || ''} ${(group.tags || []).join(' ')}`.toLowerCase());
  return matches
    .filter((match) => match?.date && match?.time)
    .map((match, index) => {
      const kickoff = parseKickoff(match);
      const cityId = GROUND_TO_CITY_ID[match.ground] || 'new-york-new-jersey';
      const city = WORLD_CUP_CITIES.find((item) => item.id === cityId) || WORLD_CUP_CITIES[7]!;
      const homeTeam = normalizePlaceholderTeam(match.team1);
      const awayTeam = normalizePlaceholderTeam(match.team2);
      const marketNeedles = [homeTeam, awayTeam, match.team1, match.team2]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const marketLinked = linkedText.some((text) => (
        text.includes('world cup') && marketNeedles.some((needle) => needle !== 'tbd' && text.includes(needle))
      ));
      return {
        id: `wc2026-${String(match.num || match.match || index + 1).padStart(3, '0')}`,
        fifaMatchNumber: Number(match.num || match.match || index + 1),
        stage: stageFromRound(match.round, match.group),
        group: match.group || '',
        round: match.round || 'World Cup',
        kickoffUtc: kickoff.toISOString(),
        kickoffBeijing: formatInTimeZone(kickoff, 'Asia/Shanghai'),
        kickoffLocal: formatInTimeZone(kickoff, city.timezone),
        cityId,
        city: city.city,
        venue: city.venue,
        homeTeam,
        awayTeam,
        status: kickoff.getTime() < Date.now() ? 'finished' : 'scheduled',
        marketLinked,
        oddsLinked: index < 12,
      } satisfies WorldCupMatch;
    })
    .sort((a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime());
}

export async function loadWorldCupDashboard(marketGroups: MarketGroupItem[] = []): Promise<WorldCupDashboardPayload> {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`world cup schedule ${response.status}`);
    const data = await response.json();
    const matches = normalizeWorldCupMatches(data.matches || [], marketGroups);
    return buildWorldCupDashboard(matches, 'remote');
  } catch {
    return buildWorldCupDashboard(normalizeWorldCupMatches(FALLBACK_SOURCE_MATCHES, marketGroups), 'fallback');
  }
}

function buildWorldCupDashboard(matches: WorldCupMatch[], cacheMode: 'remote' | 'fallback'): WorldCupDashboardPayload {
  return {
    generatedAt: new Date().toISOString(),
    cacheMode,
    tournament: {
      id: 'fifa-world-cup-2026',
      name: 'FIFA World Cup 2026',
      startsAt: matches[0]?.kickoffUtc || '2026-06-11T19:00:00Z',
      endsAt: matches[matches.length - 1]?.kickoffUtc || '2026-07-19T19:00:00Z',
      timezone: 'Asia/Shanghai',
    },
    cities: WORLD_CUP_CITIES,
    matches,
    news: fallbackNews(),
    weather: buildWeatherSeed(),
    rosters: buildRosterSeed(),
    odds: buildOddsSeed(matches),
  };
}

export function getNextWorldCupMatch(matches: WorldCupMatch[], now = new Date()) {
  return matches.find((match) => new Date(match.kickoffUtc) > now) || null;
}

export function matchCity(cities: WorldCupVenueCity[], cityId: string) {
  return cities.find((city) => city.id === cityId) || cities[0] || WORLD_CUP_CITIES[0]!;
}

export function filterWorldCupNews(content: ContentItem[], selected?: WorldCupMatch | null): WorldCupNewsItem[] {
  const terms = ['world cup', 'fifa', 'soccer', 'football', 'mexico', 'canada', 'united states'];
  const selectedTerms = selected ? [selected.homeTeam, selected.awayTeam, selected.city].map((item) => item.toLowerCase()) : [];
  const items = content
    .filter((item) => {
      const text = `${item.title || ''} ${item.summary || ''} ${item.source || ''}`.toLowerCase();
      return terms.some((term) => text.includes(term)) || selectedTerms.some((term) => text.includes(term));
    })
    .slice(0, 12)
    .map((item, index) => ({
      id: String(item.id || item.url || `content-${index}`),
      title: item.title || 'World Cup intelligence item',
      source: item.source || 'INTEL',
      url: item.url || '#',
      publishedAt: item.publishedAt || new Date().toISOString(),
      summary: item.summary || '',
      matchId: selected?.id,
    }));
  const seedItems = fallbackNews(selected);
  if (items.length >= 8) return items;
  const seen = new Set(items.map((item) => `${item.source}:${item.title}`.toLowerCase()));
  return [
    ...items,
    ...seedItems.filter((item) => {
      const key = `${item.source}:${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ].slice(0, 10);
}

export function matchPolymarketMarkets(match: WorldCupMatch | null, marketGroups: MarketGroupItem[]): WorldCupPolymarketMarket[] {
  const baseTerms = ['world cup', 'fifa', 'soccer'];
  const teamTerms = match ? [match.homeTeam, match.awayTeam].map((item) => item.toLowerCase()) : [];
  return marketGroups
    .map((group) => {
      const text = `${group.title} ${group.slug || ''} ${(group.tags || []).join(' ')}`.toLowerCase();
      const baseScore = baseTerms.some((term) => text.includes(term)) ? 0.45 : 0;
      const teamScore = teamTerms.filter((term) => term && term !== 'tbd' && text.includes(term)).length * 0.25;
      const soccerScore = text.includes('sports') || text.includes('soccer') ? 0.12 : 0;
      const confidence = Math.min(0.99, baseScore + teamScore + soccerScore);
      return { group, confidence };
    })
    .filter((item) => item.confidence >= (match ? 0.45 : 0.3))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
    .map(({ group, confidence }) => ({
      matchId: match?.id,
      eventId: group.eventId,
      marketId: group.defaultMarketId,
      slug: group.slug,
      title: group.title,
      confidence,
      source: 'local-db',
      volume24h: numeric(group.volume24h),
      outcomes: (group.topOutcomes?.length ? group.topOutcomes : group.outcomes || []).slice(0, 4).map((outcome) => ({
        name: outcome.label || outcome.title || outcome.outcomeKey || 'Outcome',
        yesPrice: numeric(outcome.yesPrice),
        volume24h: numeric(outcome.volume24h),
      })),
    }));
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fallbackNews(selected?: WorldCupMatch | null): WorldCupNewsItem[] {
  const prefix = selected ? `${selected.homeTeam} vs ${selected.awayTeam}` : 'World Cup 2026';
  const city = selected?.city || 'host city';
  const venue = selected?.venue || 'stadium';
  const group = selected?.group || 'group stage';
  const matchTime = selected?.kickoffBeijing || 'tournament window';
  return [
    {
      id: 'seed-news-1',
      title: `${prefix}: schedule, venue and market watchlist`,
      source: 'POLYDATA',
      url: '#',
      publishedAt: new Date().toISOString(),
      summary: `${matchTime} · ${city} · ${venue}. Match desk is tracking lineup, liquidity and venue signals.`,
      matchId: selected?.id,
    },
    {
      id: 'seed-news-2',
      title: `${city}: host operations and weather risk enter match watch`,
      source: 'WORLD CUP DESK',
      url: '#',
      publishedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      summary: 'City weather, travel load and pitch conditions are tracked as signals.',
      cityId: selected?.cityId,
      matchId: selected?.id,
    },
    {
      id: 'seed-news-3',
      title: `${group}: standings pressure and opening-match context`,
      source: 'FIFA DESK',
      url: '#',
      publishedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      summary: 'Group round, opponent strength and rest-window context are pinned for pre-match monitoring.',
      matchId: selected?.id,
    },
    {
      id: 'seed-news-4',
      title: `${prefix}: squad announcement and injury window remains open`,
      source: 'TEAM WIRE',
      url: '#',
      publishedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
      summary: 'Official roster, coach comments and late injury updates will be merged when source feeds connect.',
      teams: selected ? [selected.homeTeam, selected.awayTeam] : undefined,
      matchId: selected?.id,
    },
    {
      id: 'seed-news-5',
      title: `${prefix}: market liquidity, odds spread and handle watch`,
      source: 'MARKET WATCH',
      url: '#',
      publishedAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      summary: 'Polymarket links, sportsbook consensus and implied probability gaps are surfaced together.',
      matchId: selected?.id,
    },
    {
      id: 'seed-news-6',
      title: `${venue}: venue readiness, travel load and security notes`,
      source: 'VENUE OPS',
      url: '#',
      publishedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
      summary: 'Capacity, local travel, pitch state and operational notes are included in the match desk.',
      cityId: selected?.cityId,
      matchId: selected?.id,
    },
    {
      id: 'seed-news-7',
      title: `${prefix}: broadcast timezone and fan-flow checklist`,
      source: 'BROADCAST',
      url: '#',
      publishedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      summary: 'Beijing and local kickoff times are tracked alongside venue and weather signals.',
      matchId: selected?.id,
    },
    {
      id: 'seed-news-8',
      title: `${prefix}: group-table scenarios and rest-window monitor`,
      source: 'GROUP DESK',
      url: '#',
      publishedAt: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      summary: 'Group pressure, rotation risk and travel cadence are tracked before kickoff.',
      matchId: selected?.id,
    },
    {
      id: 'seed-news-9',
      title: `${city}: crowd flow, transport and stadium perimeter watch`,
      source: 'OPS WIRE',
      url: '#',
      publishedAt: new Date(Date.now() - 16 * 3600 * 1000).toISOString(),
      summary: 'Host-city operations, entry windows and local transport load are pinned for match day.',
      cityId: selected?.cityId,
      matchId: selected?.id,
    },
    {
      id: 'seed-news-10',
      title: `${prefix}: bookmaker consensus and prediction-market spread`,
      source: 'ODDS DESK',
      url: '#',
      publishedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
      summary: 'Moneyline, draw pricing and liquidity gaps are compared against market watchlists.',
      matchId: selected?.id,
    },
  ];
}

function buildWeatherSeed(): WorldCupCityWeather[] {
  const conditions = ['Clear', 'Partly cloudy', 'Humid', 'Storm watch', 'Warm'];
  return WORLD_CUP_CITIES.map((city, index) => {
    const base = city.country === 'CA' ? 19 : city.country === 'MX' ? 24 : 22;
    return {
      cityId: city.id,
      current: {
        tempC: base + (index % 5),
        condition: conditions[index % conditions.length] || 'Clear',
        windKph: 8 + (index % 6) * 3,
        precipitationProbability: (index * 7) % 45,
      },
      forecast: Array.from({ length: 5 }).map((_, day) => ({
        date: new Date(Date.now() + day * 86400000).toISOString().slice(5, 10),
        highC: base + 3 + ((index + day) % 4),
        lowC: base - 5 + ((index + day) % 3),
        condition: conditions[(index + day) % conditions.length] || 'Clear',
        precipitationProbability: ((index + day) * 9) % 58,
      })),
      generatedAt: new Date().toISOString(),
    };
  });
}

function buildRosterSeed(): WorldCupTeamRoster[] {
  const seededTeams = Array.from(new Set([
    ...FALLBACK_SOURCE_MATCHES.flatMap((match) => [normalizePlaceholderTeam(match.team1), normalizePlaceholderTeam(match.team2)]),
    'United States',
    'Canada',
    'Mexico',
  ].filter((team) => team && !/^Winner |^Loser |^TBD$/.test(team))));
  return seededTeams.map((team) => ({
    team,
    updatedAt: new Date().toISOString(),
    players: [
      { name: 'Squad pending official announcement', position: 'ALL', status: 'probable' },
      { name: 'Final roster window not closed', position: 'NOTE', status: 'reserve' },
    ],
  }));
}

function buildOddsSeed(matches: WorldCupMatch[]): WorldCupOddsSnapshot[] {
  return matches.slice(0, 12).map((match, index) => ({
    matchId: match.id,
    provider: index % 2 ? 'Odds provider watch' : 'Model consensus watch',
    providerType: index % 2 ? 'online_bookmaker' : 'traditional_sportsbook',
    marketType: 'moneyline',
    generatedAt: new Date().toISOString(),
    outcomes: [
      { name: match.homeTeam, decimalOdds: 2.05 + (index % 3) * 0.22, impliedProbability: 44 + (index % 4) * 3 },
      { name: 'Draw', decimalOdds: 3.25 + (index % 2) * 0.18, impliedProbability: 28 },
      { name: match.awayTeam, decimalOdds: 2.8 + (index % 4) * 0.2, impliedProbability: 31 - (index % 3) * 2 },
    ],
  }));
}
