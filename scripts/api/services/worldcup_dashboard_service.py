from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from api.services import worldcup_intel_service


WORLDCUP_DASHBOARD_NAMESPACE = "snapshot:sports:worldcup-dashboard"
WORLDCUP_DASHBOARD_CACHE_KEY = "dashboard-v1"
DEFAULT_TTL_SECONDS = 900
OPENFOOTBALL_2026_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
MS_PER_MINUTE = 60 * 1000

WORLD_CUP_CITIES: List[Dict[str, Any]] = [
    {"id": "atlanta", "city": "Atlanta", "country": "US", "countryName": "United States", "venue": "Mercedes-Benz Stadium", "latitude": 33.7554, "longitude": -84.4008, "timezone": "America/New_York", "capacity": 71000},
    {"id": "boston", "city": "Boston / Foxborough", "country": "US", "countryName": "United States", "venue": "Gillette Stadium", "latitude": 42.0909, "longitude": -71.2643, "timezone": "America/New_York", "capacity": 65878},
    {"id": "dallas", "city": "Dallas / Arlington", "country": "US", "countryName": "United States", "venue": "AT&T Stadium", "latitude": 32.7473, "longitude": -97.0945, "timezone": "America/Chicago", "capacity": 80000},
    {"id": "houston", "city": "Houston", "country": "US", "countryName": "United States", "venue": "NRG Stadium", "latitude": 29.6847, "longitude": -95.4107, "timezone": "America/Chicago", "capacity": 72220},
    {"id": "kansas-city", "city": "Kansas City", "country": "US", "countryName": "United States", "venue": "Arrowhead Stadium", "latitude": 39.0489, "longitude": -94.4839, "timezone": "America/Chicago", "capacity": 76416},
    {"id": "los-angeles", "city": "Los Angeles / Inglewood", "country": "US", "countryName": "United States", "venue": "SoFi Stadium", "latitude": 33.9535, "longitude": -118.3392, "timezone": "America/Los_Angeles", "capacity": 70240},
    {"id": "miami", "city": "Miami Gardens", "country": "US", "countryName": "United States", "venue": "Hard Rock Stadium", "latitude": 25.958, "longitude": -80.2389, "timezone": "America/New_York", "capacity": 65326},
    {"id": "new-york-new-jersey", "city": "New York / New Jersey", "country": "US", "countryName": "United States", "venue": "MetLife Stadium", "latitude": 40.8135, "longitude": -74.0745, "timezone": "America/New_York", "capacity": 82500},
    {"id": "philadelphia", "city": "Philadelphia", "country": "US", "countryName": "United States", "venue": "Lincoln Financial Field", "latitude": 39.9008, "longitude": -75.1675, "timezone": "America/New_York", "capacity": 67594},
    {"id": "san-francisco", "city": "San Francisco Bay Area", "country": "US", "countryName": "United States", "venue": "Levi's Stadium", "latitude": 37.403, "longitude": -121.97, "timezone": "America/Los_Angeles", "capacity": 68500},
    {"id": "seattle", "city": "Seattle", "country": "US", "countryName": "United States", "venue": "Lumen Field", "latitude": 47.5952, "longitude": -122.3316, "timezone": "America/Los_Angeles", "capacity": 69000},
    {"id": "guadalajara", "city": "Guadalajara / Zapopan", "country": "MX", "countryName": "Mexico", "venue": "Estadio Akron", "latitude": 20.6818, "longitude": -103.4623, "timezone": "America/Mexico_City", "capacity": 49850},
    {"id": "mexico-city", "city": "Mexico City", "country": "MX", "countryName": "Mexico", "venue": "Estadio Azteca", "latitude": 19.3029, "longitude": -99.1505, "timezone": "America/Mexico_City", "capacity": 87523},
    {"id": "monterrey", "city": "Monterrey / Guadalupe", "country": "MX", "countryName": "Mexico", "venue": "Estadio BBVA", "latitude": 25.6683, "longitude": -100.2446, "timezone": "America/Monterrey", "capacity": 53500},
    {"id": "toronto", "city": "Toronto", "country": "CA", "countryName": "Canada", "venue": "BMO Field", "latitude": 43.6332, "longitude": -79.4186, "timezone": "America/Toronto", "capacity": 45000},
    {"id": "vancouver", "city": "Vancouver", "country": "CA", "countryName": "Canada", "venue": "BC Place", "latitude": 49.2767, "longitude": -123.1119, "timezone": "America/Vancouver", "capacity": 54500},
]

GROUND_TO_CITY_ID = {
    "Atlanta": "atlanta",
    "Boston (Foxborough)": "boston",
    "Dallas (Arlington)": "dallas",
    "Houston": "houston",
    "Kansas City": "kansas-city",
    "Los Angeles (Inglewood)": "los-angeles",
    "Miami (Miami Gardens)": "miami",
    "New York/New Jersey (East Rutherford)": "new-york-new-jersey",
    "Philadelphia": "philadelphia",
    "San Francisco Bay Area (Santa Clara)": "san-francisco",
    "Seattle": "seattle",
    "Guadalajara (Zapopan)": "guadalajara",
    "Mexico City": "mexico-city",
    "Monterrey (Guadalupe)": "monterrey",
    "Toronto": "toronto",
    "Vancouver": "vancouver",
}

FALLBACK_SOURCE_MATCHES = [
    {"num": 1, "date": "2026-06-11", "time": "13:00 UTC-6", "team1": "Mexico", "team2": "South Africa", "group": "Group A", "round": "Matchday 1", "ground": "Mexico City"},
    {"num": 2, "date": "2026-06-11", "time": "20:00 UTC-7", "team1": "South Korea", "team2": "Czech Republic", "group": "Group A", "round": "Matchday 1", "ground": "Guadalajara (Zapopan)"},
    {"num": 7, "date": "2026-06-12", "time": "15:00 UTC-4", "team1": "Canada", "team2": "Bosnia & Herzegovina", "group": "Group B", "round": "Matchday 1", "ground": "Toronto"},
    {"num": 19, "date": "2026-06-16", "time": "20:00 UTC-6", "team1": "Argentina", "team2": "Algeria", "group": "Group D", "round": "Matchday 2", "ground": "Kansas City"},
    {"num": 55, "date": "2026-06-16", "time": "20:00 UTC-7", "team1": "Argentina", "team2": "Algeria", "group": "Group D", "round": "Matchday 2", "ground": "Vancouver"},
]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _headers() -> Dict[str, str]:
    return {"Accept": "application/json", "User-Agent": "polydata-worldcup-dashboard-seed/1.0"}


def _city_by_id(city_id: str) -> Dict[str, Any]:
    return next((city for city in WORLD_CUP_CITIES if city["id"] == city_id), WORLD_CUP_CITIES[7])


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return default


def _parse_kickoff(match: Dict[str, Any]) -> datetime:
    date_value = str(match.get("date") or "2026-06-11")
    time_value = str(match.get("time") or "00:00 UTC+0")
    parsed = re.match(r"^(\d{1,2}):(\d{2})\s+UTC([+-]\d{1,2})(?::?(\d{2}))?$", time_value)
    if not parsed:
        return datetime.fromisoformat(f"{date_value}T00:00:00+00:00")
    hour, minute, offset_hours, offset_minutes = parsed.groups()
    naive_utc = datetime(
        int(date_value[:4]),
        int(date_value[5:7]),
        int(date_value[8:10]),
        int(hour),
        int(minute),
        tzinfo=timezone.utc,
    )
    sign = -1 if str(offset_hours).startswith("-") else 1
    offset_total_minutes = sign * (abs(int(offset_hours)) * 60 + int(offset_minutes or 0))
    return datetime.fromtimestamp(naive_utc.timestamp() - offset_total_minutes * 60, tz=timezone.utc)


def _stage_from_round(round_name: str = "", group: str = "") -> str:
    text = f"{round_name} {group}".lower()
    if "final" in text and "third" in text:
        return "third_place"
    if "final" in text:
        return "final"
    if "semi" in text:
        return "semifinal"
    if "quarter" in text:
        return "quarterfinal"
    if "round of 16" in text:
        return "round16"
    if "round of 32" in text:
        return "round32"
    return "group"


def _format_in_timezone(value: datetime, timezone_name: str) -> str:
    try:
        return value.astimezone(ZoneInfo(timezone_name)).strftime("%a, %d %b, %H:%M")
    except Exception:
        return value.strftime("%a, %d %b, %H:%M")


def _normalize_team(team: Any) -> str:
    text = str(team or "").strip()
    if not text:
        return "TBD"
    winner = re.match(r"^W(\d+)$", text)
    if winner:
        return f"Winner M{winner.group(1)}"
    loser = re.match(r"^L(\d+)$", text)
    if loser:
        return f"Loser M{loser.group(1)}"
    group_rank = re.match(r"^([123])([A-L])$", text)
    if group_rank:
        return f"{group_rank.group(2)}{group_rank.group(1)}"
    third_place = re.match(r"^3([A-L](?:/[A-L])*)$", text)
    if third_place:
        return f"3rd {third_place.group(1)}"
    return text


def _fetch_schedule_source(ctx: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    getter = ctx.get("http_json_get")
    if callable(getter):
        try:
            payload = getter(OPENFOOTBALL_2026_URL, timeout=12, headers=_headers())
            matches = payload.get("matches") if isinstance(payload, dict) else None
            if isinstance(matches, list) and matches:
                return [row for row in matches if isinstance(row, dict)], "openfootball/worldcup.json"
        except Exception:
            pass
    return FALLBACK_SOURCE_MATCHES, "fallback"


def _normalize_matches(source_matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    rows: List[Dict[str, Any]] = []
    for index, match in enumerate(source_matches):
        kickoff = _parse_kickoff(match)
        city_id = GROUND_TO_CITY_ID.get(str(match.get("ground") or ""), "new-york-new-jersey")
        city = _city_by_id(city_id)
        home_team = _normalize_team(match.get("team1"))
        away_team = _normalize_team(match.get("team2"))
        match_number = _safe_int(match.get("num") or match.get("match") or index + 1, index + 1)
        rows.append(
            {
                "id": f"wc2026-{match_number:03d}",
                "fifaMatchNumber": match_number,
                "stage": _stage_from_round(str(match.get("round") or ""), str(match.get("group") or "")),
                "group": str(match.get("group") or ""),
                "round": str(match.get("round") or "World Cup"),
                "kickoffUtc": kickoff.isoformat().replace("+00:00", "Z"),
                "kickoffBeijing": _format_in_timezone(kickoff, "Asia/Shanghai"),
                "kickoffLocal": _format_in_timezone(kickoff, str(city.get("timezone") or "UTC")),
                "cityId": city_id,
                "city": city["city"],
                "venue": city["venue"],
                "homeTeam": home_team,
                "awayTeam": away_team,
                "status": "finished" if kickoff < now else "scheduled",
                "marketLinked": index < 18,
                "oddsLinked": index < 24,
            }
        )
    return sorted(rows, key=lambda row: str(row.get("kickoffUtc") or ""))


def _fallback_news(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    next_match = next((match for match in matches if match.get("status") == "scheduled"), matches[0] if matches else {})
    return [
        {
            "id": "worldcup-command-map-status",
            "title": "World Cup host-city command map is running from the seeded dashboard snapshot",
            "source": "PolyMonitor",
            "url": "#",
            "publishedAt": _utc_now_iso(),
            "summary": f"Next match context: {next_match.get('homeTeam', 'TBD')} vs {next_match.get('awayTeam', 'TBD')} in {next_match.get('city', 'host city')}.",
            "matchId": next_match.get("id"),
            "cityId": next_match.get("cityId"),
        },
        {
            "id": "worldcup-markets-weather-watch",
            "title": "Weather, venue and market layers are refreshed through the World Cup seed pipeline",
            "source": "PolyMonitor",
            "url": "#",
            "publishedAt": _utc_now_iso(),
            "summary": "The dashboard preserves the latest Redis or SQLite snapshot if upstream providers fail.",
        },
    ]


def _fallback_weather() -> List[Dict[str, Any]]:
    generated_at = _utc_now_iso()
    condition_by_country = {"US": "Clear", "CA": "Cool", "MX": "Warm"}
    rows: List[Dict[str, Any]] = []
    for index, city in enumerate(WORLD_CUP_CITIES):
        base_temp = 18 + (index % 7) + (3 if city["country"] == "MX" else 0) - (2 if city["country"] == "CA" else 0)
        forecast = []
        for day in range(5):
            forecast.append(
                {
                    "date": f"2026-06-{11 + day:02d}",
                    "highC": base_temp + 3 + (day % 2),
                    "lowC": base_temp - 4,
                    "condition": condition_by_country.get(str(city["country"]), "Clear"),
                    "precipitationProbability": 10 + ((index + day) % 5) * 7,
                }
            )
        rows.append(
            {
                "cityId": city["id"],
                "current": {
                    "tempC": base_temp,
                    "condition": condition_by_country.get(str(city["country"]), "Clear"),
                    "windKph": 6 + (index % 5) * 2,
                    "precipitationProbability": forecast[0]["precipitationProbability"],
                },
                "forecast": forecast,
                "generatedAt": generated_at,
                "source": "seed-estimate",
            }
        )
    return rows


def _merge_weather(seed_weather: List[Dict[str, Any]], runtime_weather: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = {str(item.get("cityId")): item for item in seed_weather if isinstance(item, dict) and item.get("cityId")}
    for item in runtime_weather:
        if isinstance(item, dict) and item.get("cityId"):
            rows[str(item["cityId"])] = item
    return list(rows.values())


def _odds_for_matches(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    odds: List[Dict[str, Any]] = []
    for index, match in enumerate(matches[:36]):
        home_prob = 0.38 + ((index % 5) * 0.015)
        draw_prob = 0.28 - ((index % 3) * 0.01)
        away_prob = max(0.18, 1 - home_prob - draw_prob)
        outcomes = [
            {"name": str(match.get("homeTeam") or "Home"), "decimalOdds": round(1 / home_prob, 2), "impliedProbability": round(home_prob, 3)},
            {"name": "Draw", "decimalOdds": round(1 / draw_prob, 2), "impliedProbability": round(draw_prob, 3)},
            {"name": str(match.get("awayTeam") or "Away"), "decimalOdds": round(1 / away_prob, 2), "impliedProbability": round(away_prob, 3)},
        ]
        odds.append(
            {
                "matchId": match.get("id"),
                "provider": "Model consensus watch",
                "providerType": "traditional_sportsbook",
                "marketType": "moneyline",
                "outcomes": outcomes,
                "generatedAt": _utc_now_iso(),
            }
        )
    return odds


def _rosters(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    teams: List[str] = []
    for match in matches:
        for side in (match.get("homeTeam"), match.get("awayTeam")):
            text = str(side or "")
            if text and text != "TBD" and not text.startswith(("Winner ", "Loser ", "3rd ")) and text not in teams:
                teams.append(text)
    return [{"team": team, "updatedAt": _utc_now_iso(), "players": []} for team in teams[:48]]


def _normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    matches = payload.get("matches") if isinstance(payload.get("matches"), list) else []
    cities = payload.get("cities") if isinstance(payload.get("cities"), list) else WORLD_CUP_CITIES
    weather = payload.get("weather") if isinstance(payload.get("weather"), list) else []
    news = payload.get("news") if isinstance(payload.get("news"), list) else []
    rosters = payload.get("rosters") if isinstance(payload.get("rosters"), list) else []
    odds = payload.get("odds") if isinstance(payload.get("odds"), list) else []
    return {
        "generatedAt": str(payload.get("generatedAt") or _utc_now_iso()),
        "cacheMode": str(payload.get("cacheMode") or "seeded"),
        "tournament": payload.get("tournament") if isinstance(payload.get("tournament"), dict) else {
            "id": "fifa-world-cup-2026",
            "name": "FIFA World Cup 2026",
            "startsAt": "2026-06-11T19:00:00Z",
            "endsAt": "2026-07-19T19:00:00Z",
            "timezone": "Asia/Shanghai",
        },
        "cities": cities,
        "matches": matches,
        "news": news,
        "weather": weather,
        "rosters": rosters,
        "odds": odds,
        "intelligence": payload.get("intelligence") if isinstance(payload.get("intelligence"), dict) else None,
        "source": str(payload.get("source") or "World Cup dashboard seed"),
        "sourceUrl": str(payload.get("sourceUrl") or OPENFOOTBALL_2026_URL),
        "providerStates": payload.get("providerStates") if isinstance(payload.get("providerStates"), dict) else {},
        "summary": {
            "cities": len(cities),
            "matches": len(matches),
            "news": len(news),
            "weatherCities": len(weather),
            "rosters": len(rosters),
            "odds": len(odds),
        },
    }


def build_worldcup_dashboard_payload(ctx: Dict[str, Any]) -> Dict[str, Any]:
    generated_at = _utc_now_iso()
    source_matches, schedule_source = _fetch_schedule_source(ctx)
    matches = _normalize_matches(source_matches)
    fallback_weather = _fallback_weather()
    intel: Optional[Dict[str, Any]] = None
    try:
        intel = worldcup_intel_service.get_worldcup_intel_snapshot(ctx, limit=120)
    except Exception as exc:
        intel = {"status": "error", "cacheMode": "fallback", "error": exc.__class__.__name__, "news": [], "weather": [], "signals": []}
    weather = _merge_weather(fallback_weather, intel.get("weather") if isinstance(intel, dict) and isinstance(intel.get("weather"), list) else [])
    intel_news = intel.get("news") if isinstance(intel, dict) and isinstance(intel.get("news"), list) else []
    news = [*intel_news[:24], *_fallback_news(matches)]
    starts_at = matches[0]["kickoffUtc"] if matches else "2026-06-11T19:00:00Z"
    ends_at = matches[-1]["kickoffUtc"] if matches else "2026-07-19T19:00:00Z"
    return _normalize_payload(
        {
            "generatedAt": generated_at,
            "cacheMode": "seeded",
            "tournament": {
                "id": "fifa-world-cup-2026",
                "name": "FIFA World Cup 2026",
                "startsAt": starts_at,
                "endsAt": ends_at,
                "timezone": "Asia/Shanghai",
            },
            "cities": WORLD_CUP_CITIES,
            "matches": matches,
            "news": news,
            "weather": weather,
            "rosters": _rosters(matches),
            "odds": _odds_for_matches(matches),
            "intelligence": intel,
            "source": f"{schedule_source} / {intel.get('source') if isinstance(intel, dict) else 'runtime intel'}",
            "sourceUrl": OPENFOOTBALL_2026_URL,
            "providerStates": {
                "schedule": "ok" if len(matches) >= 100 else "fallback",
                "dashboardSeed": "ok",
                "worldcupIntel": str((intel or {}).get("status") or "unknown"),
                "weather": "ok" if weather else "empty",
            },
        }
    )


def _read_cached(ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    reader = ctx.get("get_cached_json")
    if callable(reader):
        cached = reader(WORLDCUP_DASHBOARD_NAMESPACE, WORLDCUP_DASHBOARD_CACHE_KEY)
        if isinstance(cached, dict):
            return {**_normalize_payload(cached), "cacheMode": "redis"}
    store = ctx.get("SNAPSHOT_STORE")
    if store is not None:
        cached = store.get(WORLDCUP_DASHBOARD_NAMESPACE, WORLDCUP_DASHBOARD_CACHE_KEY)
        if isinstance(cached, dict):
            return {**_normalize_payload(cached), "cacheMode": "sqlite"}
        stale = store.get_stale(WORLDCUP_DASHBOARD_NAMESPACE, WORLDCUP_DASHBOARD_CACHE_KEY)
        if isinstance(stale, dict):
            return {**_normalize_payload(stale), "cacheMode": "stale"}
    return None


def _store(ctx: Dict[str, Any], payload: Dict[str, Any], ttl_seconds: int) -> None:
    store = ctx.get("SNAPSHOT_STORE")
    if store is not None:
        store.set(WORLDCUP_DASHBOARD_NAMESPACE, WORLDCUP_DASHBOARD_CACHE_KEY, payload, ttl_seconds)
    setter = ctx.get("set_cached_json")
    if callable(setter):
        setter(WORLDCUP_DASHBOARD_NAMESPACE, WORLDCUP_DASHBOARD_CACHE_KEY, payload, ttl_seconds)


def get_worldcup_dashboard_snapshot(ctx: Dict[str, Any]) -> Dict[str, Any]:
    ttl_seconds = max(300, int(getattr(ctx.get("SETTINGS"), "sports_runtime_ttl_seconds", DEFAULT_TTL_SECONDS) or DEFAULT_TTL_SECONDS))
    cached = _read_cached(ctx)
    if cached and cached.get("cacheMode") != "stale":
        return cached
    try:
        payload = build_worldcup_dashboard_payload(ctx)
        _store(ctx, payload, ttl_seconds)
        return payload
    except Exception as exc:
        if cached:
            return {**cached, "status": "stale", "error": exc.__class__.__name__}
        return _normalize_payload(
            {
                "generatedAt": _utc_now_iso(),
                "cacheMode": "fallback",
                "matches": _normalize_matches(FALLBACK_SOURCE_MATCHES),
                "cities": WORLD_CUP_CITIES,
                "weather": _fallback_weather(),
                "news": [],
                "rosters": [],
                "odds": [],
                "providerStates": {"dashboardSeed": f"error:{exc.__class__.__name__}"},
            }
        )
