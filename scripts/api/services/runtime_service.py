from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def get_market_group_snapshot(ctx: dict, items: List[tuple[str, str, str]], *, kind: str) -> Dict[str, Any]:
    ttl_seconds = 10 if kind == "crypto" else ctx["FINANCE_RUNTIME_TTL_SECONDS"]
    cache_key = json.dumps(
        {
            "kind": kind,
            "symbols": [symbol for _, _, symbol in items],
            "snapshotVersion": 2 if kind == "crypto" else 1,
        },
        sort_keys=True,
        ensure_ascii=True,
    )

    def _builder() -> Dict[str, Any]:
        rows_by_symbol: Dict[str, Dict[str, Any]] = {}

        def _load_row(entry: tuple[str, str, str]) -> tuple[str, Optional[Dict[str, Any]]]:
            key, label, symbol = entry
            is_crypto = kind == "crypto"
            try:
                snapshot = ctx["get_yahoo_market_snapshot"](
                    symbol,
                    interval="5m" if is_crypto else "30m",
                    range_name="1d" if is_crypto else "5d",
                    ttl_seconds=5 if is_crypto else None,
                )
            except Exception:
                ctx["app"].logger.exception("yahoo snapshot failed symbol=%s", symbol)
                snapshot = None
            if not snapshot:
                return symbol, None
            return symbol, {
                "id": key,
                "label": label,
                "symbol": symbol,
                "price": snapshot.get("price"),
                "changePercent": snapshot.get("changePercent"),
                "points": snapshot.get("points") or [],
            }

        max_workers = min(8, max(1, len(items)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_load_row, item) for item in items]
            for future in as_completed(futures):
                symbol, row = future.result()
                if row is not None:
                    rows_by_symbol[symbol] = row

        rows = [rows_by_symbol[symbol] for _, _, symbol in items if symbol in rows_by_symbol]
        if kind == "crypto" and len(rows) < len(items):
            try:
                ids = [ctx["CRYPTO_COINGECKO_IDS"][symbol] for _, _, symbol in items if symbol in ctx["CRYPTO_COINGECKO_IDS"]]
                payload = ctx["http_json_get"](
                    f"{ctx['SETTINGS'].coingecko_base_url.rstrip('/')}/coins/markets",
                    params={
                        "vs_currency": "usd",
                        "ids": ",".join(ids),
                        "sparkline": "true",
                        "price_change_percentage": "24h",
                    },
                    timeout=12,
                    headers={"User-Agent": "polydata-runtime/1.0", "Accept": "application/json"},
                ) or []
                by_id = {str(item.get("id")): item for item in payload if isinstance(item, dict)}
                yahoo_rows = {str(item.get("symbol")): item for item in rows if isinstance(item, dict)}
                merged_rows = []
                for key, label, symbol in items:
                    existing = yahoo_rows.get(symbol)
                    if existing:
                        merged_rows.append(existing)
                        continue
                    coin = by_id.get(ctx["CRYPTO_COINGECKO_IDS"].get(symbol, ""))
                    if not coin:
                        continue
                    spark = (((coin.get("sparkline_in_7d") or {}).get("price")) or [])[-48:]
                    points = [
                        {
                            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                            "value": ctx["_safe_float"](value),
                        }
                        for value in spark
                        if ctx["_safe_float"](value) is not None
                    ]
                    merged_rows.append(
                        {
                            "id": key,
                            "label": label,
                            "symbol": symbol,
                            "price": ctx["_safe_float"](coin.get("current_price")),
                            "changePercent": ctx["_safe_float"](coin.get("price_change_percentage_24h")),
                            "points": points,
                        }
                    )
                rows = merged_rows
            except Exception:
                ctx["app"].logger.exception("coingecko crypto fallback failed")
        return {"kind": kind, "items": rows, "generatedAt": ctx["utc_now_iso"]()}

    if kind == "crypto":
        return _builder()
    return ctx["get_snapshot_payload"](f"snapshot:markets:{kind}", cache_key, _builder, ttl_seconds=ttl_seconds)


def get_nba_scoreboard_snapshot(ctx: dict, limit: int = 10) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        payload = ctx["http_json_get"](
            f"{ctx['SETTINGS'].espn_nba_base_url.rstrip('/')}/scoreboard",
            params={"limit": limit},
            timeout=12,
        ) or {}
        events = payload.get("events") or []
        games = []
        for event in events[:limit]:
            competitions = event.get("competitions") or []
            competition = competitions[0] if competitions else {}
            competitors = competition.get("competitors") or []
            away = next((item for item in competitors if item.get("homeAway") == "away"), None)
            home = next((item for item in competitors if item.get("homeAway") == "home"), None)
            status = (((competition.get("status") or {}).get("type")) or {})
            games.append(
                {
                    "id": event.get("id"),
                    "name": event.get("shortName") or event.get("name"),
                    "status": status.get("description") or status.get("detail"),
                    "state": status.get("state"),
                    "tipoff": event.get("date"),
                    "homeTeam": ((home or {}).get("team") or {}).get("displayName"),
                    "awayTeam": ((away or {}).get("team") or {}).get("displayName"),
                    "homeScore": (home or {}).get("score"),
                    "awayScore": (away or {}).get("score"),
                    "broadcast": (((competition.get("broadcasts") or [None])[0]) or {}).get("names", [None])[0],
                }
            )
        return {"items": games, "generatedAt": ctx["utc_now_iso"]()}

    return ctx["get_snapshot_payload"]("snapshot:sports:nba", cache_key, _builder, ttl_seconds=ctx["SPORTS_RUNTIME_TTL_SECONDS"])


def get_nba_intel_snapshot(ctx: dict, limit: int = 12) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": limit}, sort_keys=True, ensure_ascii=True)

    def _builder() -> Dict[str, Any]:
        news_items: List[Dict[str, Any]] = []
        lineup_items: List[Dict[str, Any]] = []
        try:
            payload = ctx["http_json_get"](
                f"{ctx['SETTINGS'].espn_nba_base_url.rstrip('/')}/news",
                timeout=12,
                headers={"User-Agent": "polydata-runtime/1.0", "Accept": "application/json"},
            ) or {}
            for article in (payload.get("articles") or [])[:limit]:
                headline = str(article.get("headline") or "").strip()
                if not headline:
                    continue
                source_node = article.get("source") or {}
                source = source_node.get("name") if isinstance(source_node, dict) else None
                links = article.get("links") or {}
                web_link = ((links.get("web") or {}).get("href")) if isinstance(links, dict) else None
                news_items.append(
                    {
                        "headline": headline,
                        "description": (article.get("description") or article.get("story") or "")[:280] or None,
                        "publishedAt": article.get("published") or article.get("lastModified"),
                        "url": web_link,
                        "source": source or "ESPN",
                        "type": "news",
                    }
                )
        except Exception:
            ctx["app"].logger.exception("nba intel news fetch failed")

        try:
            lineup_date = datetime.now(timezone.utc).strftime("%Y%m%d")
            payload = ctx["http_json_get"](
                f"{ctx['SETTINGS'].nba_lineups_base_url.rstrip('/')}/00_daily_lineups_{lineup_date}.json",
                timeout=12,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "application/json, text/plain, */*",
                    "Referer": "https://www.nba.com/",
                    "Origin": "https://www.nba.com",
                },
            ) or {}
            for game in (payload.get("games") or [])[: min(limit, 8)]:
                home_team = ((game.get("homeTeam") or {}).get("teamName")) or ((game.get("homeTeam") or {}).get("teamTricode"))
                away_team = ((game.get("awayTeam") or {}).get("teamName")) or ((game.get("awayTeam") or {}).get("teamTricode"))
                starters: List[Dict[str, Any]] = []
                for bucket_key, side_label in (("homePlayers", "HOME"), ("awayPlayers", "AWAY")):
                    for player in (game.get(bucket_key) or []):
                        player_name = str(player.get("playerName") or "").strip()
                        if not player_name:
                            continue
                        starters.append(
                            {
                                "side": side_label,
                                "playerName": player_name,
                                "position": player.get("position") or "",
                                "lineupStatus": player.get("lineupStatus") or player.get("rosterStatus") or "",
                                "timestamp": player.get("timestamp"),
                            }
                        )
                lineup_items.append(
                    {
                        "gameId": game.get("gameId"),
                        "label": f"{away_team or 'Away'} @ {home_team or 'Home'}",
                        "status": game.get("gameStatusText") or game.get("gameStatus"),
                        "starters": starters[:10],
                    }
                )
        except Exception:
            ctx["app"].logger.exception("nba intel lineup fetch failed")
        return {"items": news_items, "lineups": lineup_items, "generatedAt": ctx["utc_now_iso"]()}

    return ctx["get_snapshot_payload"]("snapshot:sports:nba-intel", cache_key, _builder, ttl_seconds=ctx["SPORTS_RUNTIME_TTL_SECONDS"])


def get_inflation_nowcast_snapshot(ctx: dict) -> Dict[str, Any]:
    cache_key = "latest"

    def _builder() -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "monthOverMonth": None,
            "yearOverYear": None,
            "quarterly": [],
            "generatedAt": ctx["utc_now_iso"](),
            "source": "Cleveland Fed Inflation Nowcasting",
            "url": ctx["SETTINGS"].cleveland_fed_nowcast_url,
        }
        if ctx["requests"] is None or ctx["BeautifulSoup"] is None:
            return payload
        try:
            response = ctx["requests"].get(
                payload["url"],
                timeout=15,
                headers={"User-Agent": "polydata-runtime/1.0", "Accept": "text/html,application/xhtml+xml"},
            )
            response.raise_for_status()
            soup = ctx["BeautifulSoup"](response.text, "html.parser")
            for table in soup.find_all("table"):
                caption = table.find("caption")
                caption_text = " ".join(caption.get_text(" ", strip=True).split()).lower() if caption else ""
                headers = [th.get_text(" ", strip=True) for th in table.find_all("th")]
                rows: List[Dict[str, str]] = []
                for tr in table.find_all("tr"):
                    cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
                    if not cells or len(cells) != len(headers):
                        continue
                    rows.append({headers[index]: cells[index] for index in range(len(headers))})
                if not rows:
                    continue
                if "month-over-month percent change" in caption_text:
                    payload["monthOverMonth"] = rows[0]
                elif "year-over-year percent change" in caption_text:
                    payload["yearOverYear"] = rows[0]
                elif "quarterly annualized percent change" in caption_text:
                    payload["quarterly"] = rows[:4]
        except Exception:
            ctx["app"].logger.exception("inflation nowcast fetch failed")
        return payload

    return ctx["get_snapshot_payload"](
        "snapshot:macro:inflation-nowcast",
        cache_key,
        _builder,
        ttl_seconds=max(ctx["FINANCE_RUNTIME_TTL_SECONDS"], 1800),
    )
