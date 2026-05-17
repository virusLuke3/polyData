from __future__ import annotations

import hashlib
from typing import Any, Dict, Iterable, List, Optional

from .models import MessageCandidate


def _text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _pct(value: Any) -> str:
    number = _number(value)
    if number is None:
        return "n/a"
    if 0 <= number <= 1:
        number *= 100
    return f"{number:.0f}%"


def _price(value: Any) -> str:
    number = _number(value)
    if number is None:
        return "n/a"
    return f"{number * 100:.0f}c" if 0 <= number <= 1 else f"{number:.2f}"


def _short_hash(*parts: Any) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _first_url(*values: Any) -> str:
    for value in values:
        text = _text(value)
        if text.startswith("http://") or text.startswith("https://"):
            return text
    return ""


def _iter_items(payload: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    for item in payload.get("items") or []:
        if isinstance(item, dict):
            yield item


def format_nba_scoreboard(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for game in _iter_items(payload):
        game_id = _text(game.get("id") or game.get("eventId") or game.get("name"))
        away = _text(game.get("awayTeam"), "Away")
        home = _text(game.get("homeTeam"), "Home")
        away_score = _text(game.get("awayScore"), "-")
        home_score = _text(game.get("homeScore"), "-")
        status = _text(game.get("status") or game.get("state"), "scheduled")
        tipoff = _text(game.get("tipoff"))
        broadcast = _text(game.get("broadcast"))
        score_line = f"{away} {away_score} @ {home} {home_score}" if away_score != "-" or home_score != "-" else f"{away} @ {home}"
        details = " | ".join(part for part in (status, tipoff, broadcast) if part)
        text = f"NBA scoreboard\n{score_line}\n{details}".strip()
        dedupe = _short_hash("nba-scoreboard", game_id, away_score, home_score, status)
        priority = "high" if str(game.get("state") or "").lower() in {"post", "final"} or "final" in status.lower() else "normal"
        messages.append(MessageCandidate(topic="nba", dedupe_key=dedupe, text=text, priority=priority, metadata={"panel": "nba-scoreboard"}))
    return messages


def format_nba_intel(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for item in _iter_items(payload):
        headline = _text(item.get("headline") or item.get("title"))
        if not headline:
            continue
        source = _text(item.get("source"), "NBA intel")
        description = _text(item.get("description"))
        url = _first_url(item.get("url"))
        pieces = [f"NBA intel\n{headline}", source]
        if description:
            pieces.append(description[:240])
        if url:
            pieces.append(url)
        dedupe = _short_hash("nba-intel", headline.lower(), url)
        messages.append(MessageCandidate(topic="nba", dedupe_key=dedupe, text="\n".join(pieces), priority="normal", metadata={"panel": "nba-intel"}, link_preview=bool(url)))

    for lineup in payload.get("lineups") or []:
        if not isinstance(lineup, dict):
            continue
        label = _text(lineup.get("label"))
        status = _text(lineup.get("status"))
        starters = lineup.get("starters") if isinstance(lineup.get("starters"), list) else []
        if not label or not starters:
            continue
        starter_names = ", ".join(_text(player.get("playerName")) for player in starters[:6] if isinstance(player, dict) and _text(player.get("playerName")))
        text = f"NBA lineup\n{label}\n{status}\n{starter_names}".strip()
        dedupe = _short_hash("nba-lineup", lineup.get("gameId"), status, starter_names)
        messages.append(MessageCandidate(topic="nba", dedupe_key=dedupe, text=text, priority="normal", metadata={"panel": "nba-intel"}))
    return messages


def format_nba_predictor(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for item in _iter_items(payload):
        event_id = _text(item.get("eventId") or item.get("id") or item.get("shortName"))
        away = _text(item.get("awayTeam"), "Away")
        home = _text(item.get("homeTeam"), "Home")
        away_prob = _number(item.get("awayWinProbability"))
        home_prob = _number(item.get("homeWinProbability"))
        quality = _number(item.get("matchupQuality"))
        margin = _number(item.get("projectedMargin"))
        if away_prob is None and home_prob is None and quality is None:
            continue
        line = f"{away} {_pct(away_prob)} | {home} {_pct(home_prob)}"
        extras = []
        if quality is not None:
            extras.append(f"quality {quality:.0f}")
        if margin is not None:
            extras.append(f"margin {margin:+.1f}")
        status = _text(item.get("status") or item.get("state"))
        if status:
            extras.append(status)
        text = f"NBA matchup predictor\n{away} @ {home}\n{line}\n{' | '.join(extras)}".strip()
        dedupe = _short_hash("nba-predictor", event_id, round(away_prob or -1), round(home_prob or -1), status)
        messages.append(MessageCandidate(topic="nba", dedupe_key=dedupe, text=text, priority="normal", metadata={"panel": "espn-matchup-predictor"}))
    return messages


def format_weather_map(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    hottest = summary.get("hottestCity") if isinstance(summary.get("hottestCity"), dict) else None
    if hottest:
        city = _text(hottest.get("city"), "Unknown")
        current = _text(hottest.get("currentTemp"), "n/a")
        high = _text(hottest.get("forecastHigh"), "n/a")
        live_count = _text(summary.get("liveMarketCount"), "0")
        dedupe = _short_hash("weather-summary", city, current, high, live_count)
        text = f"Weather monitor\nHottest mapped city: {city}\nCurrent {current} | forecast high {high}\nLive weather markets: {live_count}"
        messages.append(MessageCandidate(topic="weather", dedupe_key=dedupe, text=text, priority="normal", metadata={"panel": "global-weather-map"}))

    for item in _iter_items(payload):
        top_bin = item.get("topBin") if isinstance(item.get("topBin"), dict) else {}
        market_url = _first_url(item.get("marketUrl"))
        if not top_bin or not market_url:
            continue
        city = _text(item.get("city"), "Unknown")
        label = _text(top_bin.get("label") or top_bin.get("title") or top_bin.get("raw"))
        quote = _price(top_bin.get("midPriceYes"))
        coverage = _text(item.get("quoteCoverage"))
        temp = _text(item.get("currentTemp"), "n/a")
        dedupe = _short_hash("weather-market", item.get("cityId"), item.get("eventSlug"), label, quote)
        text = f"Weather market\n{city}: {label}\nYES {quote} | current {temp} | quotes {coverage}\n{market_url}".strip()
        messages.append(MessageCandidate(topic="weather", dedupe_key=dedupe, text=text, priority="high", metadata={"panel": "global-weather-map"}, link_preview=True))
    return messages


def format_weather_news(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for article in _iter_items(payload):
        severity = _text(article.get("severity"), "normal").lower()
        if severity not in {"warning", "watch"}:
            continue
        title = _text(article.get("title"))
        if not title:
            continue
        city = _text(article.get("city"))
        source = _text(article.get("source"), "Weather news")
        summary = _text(article.get("summary"))
        url = _first_url(article.get("url"))
        pieces = [f"Weather {severity}\n{title}", " | ".join(part for part in (city, source) if part)]
        if summary and summary != title:
            pieces.append(summary[:240])
        if url:
            pieces.append(url)
        dedupe = _short_hash("weather-news", article.get("id"), title.lower(), url)
        priority = "high" if severity == "warning" else "normal"
        messages.append(MessageCandidate(topic="weather", dedupe_key=dedupe, text="\n".join(part for part in pieces if part), priority=priority, metadata={"panel": "weather-news"}, link_preview=bool(url)))
    return messages


def format_latest_content(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for item in _iter_items(payload):
        title = _text(item.get("title") or item.get("headline"))
        if not title:
            continue
        source = _text(item.get("source"), "News")
        summary = _text(item.get("summary") or item.get("description"))
        url = _first_url(item.get("url"))
        pieces = [f"News\n{title}", source]
        if summary and summary != title:
            pieces.append(summary[:260])
        if url:
            pieces.append(url)
        dedupe = _short_hash("latest-content", item.get("id"), title.lower(), url)
        messages.append(MessageCandidate(topic="news", dedupe_key=dedupe, text="\n".join(part for part in pieces if part), metadata={"panel": "latest-content"}, link_preview=bool(url)))
    return messages


def format_alpha_signal(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for item in _iter_items(payload):
        title = _text(item.get("title") or item.get("marketTitle") or item.get("question") or item.get("name") or item.get("label"))
        if not title:
            continue
        signal = _text(item.get("signal") or item.get("reason") or item.get("summary") or item.get("status"))
        score = _text(item.get("score") or item.get("confidence") or item.get("rank"))
        url = _first_url(item.get("url") or item.get("marketUrl"))
        pieces = [f"Alpha signal\n{title}"]
        if signal:
            pieces.append(signal[:260])
        if score:
            pieces.append(f"score/confidence: {score}")
        if url:
            pieces.append(url)
        dedupe = _short_hash("alpha-signal", item.get("id") or item.get("marketId"), title.lower(), signal, score)
        messages.append(MessageCandidate(topic="alpha", dedupe_key=dedupe, text="\n".join(pieces), priority="high", metadata={"panel": "alpha-signal"}, link_preview=bool(url)))
    return messages


def format_new_market_signals(payload: Dict[str, Any]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for item in _iter_items(payload):
        title = _text(item.get("title") or item.get("question") or item.get("marketTitle") or item.get("eventTitle"))
        if not title:
            continue
        status = _text(item.get("status") or item.get("signal") or item.get("reason"))
        url = _first_url(item.get("url") or item.get("marketUrl"))
        pieces = [f"New market signal\n{title}"]
        if status:
            pieces.append(status[:260])
        if url:
            pieces.append(url)
        dedupe = _short_hash("new-market-signal", item.get("id") or item.get("marketId") or item.get("slug"), title.lower(), status)
        messages.append(MessageCandidate(topic="alpha", dedupe_key=dedupe, text="\n".join(pieces), priority="normal", metadata={"panel": "new-market-signals"}, link_preview=bool(url)))
    return messages


def format_macro_payload(payload: Dict[str, Any], *, panel_label: str, panel_id: str) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for item in _iter_items(payload):
        title = _text(item.get("title") or item.get("eventTitle") or item.get("name") or item.get("label") or item.get("metric"))
        if not title:
            continue
        status = _text(item.get("status") or item.get("signal") or item.get("summary") or item.get("description"))
        value = _text(item.get("value") or item.get("actual") or item.get("forecast") or item.get("probability"))
        url = _first_url(item.get("url") or item.get("sourceUrl") or item.get("marketUrl"))
        pieces = [f"{panel_label}\n{title}"]
        if status:
            pieces.append(status[:260])
        if value:
            pieces.append(f"value: {value}")
        if url:
            pieces.append(url)
        dedupe = _short_hash(panel_id, item.get("id") or item.get("eventId") or item.get("slug"), title.lower(), status, value)
        messages.append(MessageCandidate(topic="macro", dedupe_key=dedupe, text="\n".join(pieces), priority="normal", metadata={"panel": panel_id}, link_preview=bool(url)))
    return messages


def format_all_snapshots(snapshots: Dict[str, Dict[str, Any]]) -> List[MessageCandidate]:
    messages: List[MessageCandidate] = []
    for panel_id, payload in snapshots.items():
        messages.extend(format_panel_snapshot(panel_id, payload))
    return messages


def format_panel_snapshot(panel_id: str, payload: Dict[str, Any]) -> List[MessageCandidate]:
    if panel_id == "latest-content":
        return format_latest_content(payload)
    if panel_id == "alpha-signal":
        return format_alpha_signal(payload)
    if panel_id == "new-market-signals":
        return format_new_market_signals(payload)
    if panel_id == "polymarket-macro-map":
        return format_macro_payload(payload, panel_label="Macro market map", panel_id=panel_id)
    if panel_id == "cpi-release-command-center":
        return format_macro_payload(payload, panel_label="CPI command center", panel_id=panel_id)
    if panel_id == "nba-scoreboard":
        return format_nba_scoreboard(payload)
    if panel_id == "nba-intel":
        return format_nba_intel(payload)
    if panel_id == "espn-matchup-predictor":
        return format_nba_predictor(payload)
    if panel_id == "global-weather-map":
        return format_weather_map(payload)
    if panel_id == "weather-news":
        return format_weather_news(payload)
    return []
