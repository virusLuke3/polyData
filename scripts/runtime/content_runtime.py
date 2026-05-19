#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Runtime RSS fallback for content panels when DB content tables are unavailable."""

from __future__ import annotations

import threading
import time
import xml.etree.ElementTree as ET
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any, Dict, List, Optional

import requests

from data_sources import RSS_FEEDS, non_empty_feeds

DEFAULT_CACHE_TTL_SECONDS = 900
DEFAULT_TIMEOUT_SECONDS = 10
MAX_FEED_WORKERS = 8
MAX_ITEMS_PER_FEED = 25
ATOM_NS = "{http://www.w3.org/2005/Atom}"


@dataclass
class RuntimeContentItem:
    id: str
    content_type: str
    source: str
    category: str
    title: str
    url: str
    published_at: Optional[str]
    summary: str


class RuntimeContentProvider:
    def __init__(
        self,
        *,
        cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        feeds: Optional[List[Dict[str, str]]] = None,
    ) -> None:
        self.cache_ttl_seconds = max(60, int(cache_ttl_seconds))
        self.timeout_seconds = max(1, int(timeout_seconds))
        self.feeds = non_empty_feeds(feeds if feeds is not None else RSS_FEEDS)
        self._lock = threading.Lock()
        self._cache: Dict[str, Any] = {"fetched_at": 0.0, "items": []}
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
                "User-Agent": "polyData-runtime-content/1.0",
            }
        )

    def get_related_news(
        self,
        *,
        market_title: str,
        category: str,
        tags: List[str],
        limit: int = 8,
    ) -> List[Dict[str, Any]]:
        items = self._get_cached_items()
        if not items:
            return []
        keywords = self._build_keywords(market_title=market_title, category=category, tags=tags)
        scored: List[tuple[int, RuntimeContentItem]] = []
        for item in items:
            haystack = f"{item.source} {item.category} {item.title} {item.summary}".lower()
            score = sum(1 for keyword in keywords if keyword and keyword in haystack)
            if score <= 0 and self._is_broadly_relevant(item=item, category=category):
                score = 1
            if score > 0:
                scored.append((score, item))
        scored.sort(key=lambda entry: (entry[0], entry[1].published_at or "", entry[1].title), reverse=True)
        return [
            {
                "id": item.id,
                "contentType": item.content_type,
                "source": item.source,
                "category": item.category,
                "title": item.title,
                "url": item.url,
                "publishedAt": item.published_at,
                "summary": item.summary,
            }
            for _, item in scored[:limit]
        ]

    def get_latest_items(self, *, limit: int = 8) -> List[Dict[str, Any]]:
        items = self._get_cached_items()
        if not items:
            return []
        ranked = sorted(
            items,
            key=lambda item: (
                item.published_at or "",
                item.title,
            ),
            reverse=True,
        )
        return [
            {
                "id": item.id,
                "contentType": item.content_type,
                "source": item.source,
                "category": item.category,
                "title": item.title,
                "url": item.url,
                "publishedAt": item.published_at,
                "summary": item.summary,
            }
            for item in ranked[:limit]
        ]

    def _get_cached_items(self) -> List[RuntimeContentItem]:
        now = time.time()
        with self._lock:
            if now - self._cache["fetched_at"] < self.cache_ttl_seconds:
                return list(self._cache["items"])
        items = self._fetch_all_feeds()
        with self._lock:
            self._cache = {"fetched_at": now, "items": items}
        return items

    def _fetch_all_feeds(self) -> List[RuntimeContentItem]:
        items: List[RuntimeContentItem] = []
        if not self.feeds:
            return items

        def fetch_feed(feed: Dict[str, str]) -> List[RuntimeContentItem]:
            try:
                response = self._session.get(feed["url"], timeout=self.timeout_seconds)
                response.raise_for_status()
                return self._parse_feed(response.text, source=feed["source"], category=str(feed.get("category") or "News"))
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=min(MAX_FEED_WORKERS, len(self.feeds))) as executor:
            futures = [executor.submit(fetch_feed, feed) for feed in self.feeds]
            for future in as_completed(futures):
                items.extend(future.result())
        return items

    def _parse_feed(self, payload: str, *, source: str, category: str) -> List[RuntimeContentItem]:
        root = ET.fromstring(payload)
        parsed: List[RuntimeContentItem] = []
        rss_items = root.findall(".//item")
        atom_items = root.findall(f".//{ATOM_NS}entry") if not rss_items else []
        for item in (rss_items or atom_items)[:MAX_ITEMS_PER_FEED]:
            title = self._find_text(item, "title")
            url = self._find_text(item, "link") or self._find_atom_link(item)
            summary = self._clean_summary(
                self._find_text(item, "description")
                or self._find_text(item, "summary")
                or self._find_text(item, "content")
                or self._find_text(item, f"{ATOM_NS}summary")
                or self._find_text(item, f"{ATOM_NS}content")
            )
            published_raw = (
                self._find_text(item, "pubDate")
                or self._find_text(item, "published")
                or self._find_text(item, "updated")
                or self._find_text(item, f"{ATOM_NS}published")
                or self._find_text(item, f"{ATOM_NS}updated")
            )
            published_at = None
            if published_raw:
                try:
                    published_at = parsedate_to_datetime(published_raw).astimezone().isoformat()
                except Exception:
                    published_at = None
            if not title or not url:
                continue
            parsed.append(
                RuntimeContentItem(
                    id=f"{source}:{url}",
                    content_type="news",
                    source=source,
                    category=category,
                    title=unescape(title.strip()),
                    url=url.strip(),
                    published_at=published_at,
                    summary=summary,
                )
            )
        return parsed

    @staticmethod
    def _find_text(item: ET.Element, tag: str) -> str:
        node = item.find(tag)
        if node is None and not tag.startswith("{"):
            node = item.find(f"{ATOM_NS}{tag}")
        if node is None or node.text is None:
            return ""
        return node.text

    @staticmethod
    def _find_atom_link(item: ET.Element) -> str:
        for node in item.findall(f"{ATOM_NS}link"):
            href = str(node.attrib.get("href") or "").strip()
            if href:
                return href
        return ""

    @staticmethod
    def _clean_summary(value: str) -> str:
        text = unescape(str(value or "")).strip()
        if not text or text.lower() in {"null", "undefined", "none"}:
            return ""
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text.lower() in {"null", "undefined", "none"}:
            return ""
        return text[:280]

    @staticmethod
    def _is_broadly_relevant(*, item: RuntimeContentItem, category: str) -> bool:
        item_category = item.category.lower()
        market_category = str(category or "").lower()
        if item.source in {"Polymarket News"}:
            return True
        if market_category and (market_category in item_category or item_category in market_category):
            return True
        if any(token in market_category for token in ("politic", "election")) and item_category in {"politics", "elections"}:
            return True
        if any(token in market_category for token in ("crypto", "bitcoin", "ethereum")) and item_category == "crypto":
            return True
        if any(token in market_category for token in ("sport", "nba", "nfl", "mlb", "nhl", "ufc")) and item_category == "sports":
            return True
        return False

    @staticmethod
    def _build_keywords(*, market_title: str, category: str, tags: List[str]) -> List[str]:
        base = [market_title, category, *tags]
        stopwords = {
            "about",
            "active",
            "after",
            "against",
            "before",
            "down",
            "from",
            "game",
            "games",
            "higher",
            "league",
            "market",
            "markets",
            "match",
            "over",
            "premier",
            "price",
            "resolve",
            "than",
            "that",
            "this",
            "under",
            "versus",
            "will",
            "winner",
            "with",
        }
        keywords: List[str] = []
        for value in base:
            for piece in str(value or "").lower().replace("?", " ").replace(",", " ").split():
                cleaned = piece.strip()
                if len(cleaned) >= 3 and cleaned not in stopwords and cleaned not in keywords:
                    keywords.append(cleaned)
        return keywords[:16]
