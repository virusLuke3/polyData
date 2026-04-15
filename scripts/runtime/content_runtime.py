#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Runtime RSS fallback for content panels when DB content tables are unavailable."""

from __future__ import annotations

import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any, Dict, List, Optional

import requests

DEFAULT_CACHE_TTL_SECONDS = 900
DEFAULT_TIMEOUT_SECONDS = 10

RSS_FEEDS = [
    {"source": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml", "category": "World"},
    {"source": "BBC Politics", "url": "https://feeds.bbci.co.uk/news/politics/rss.xml", "category": "Politics"},
    {"source": "CoinDesk", "url": "https://www.coindesk.com/arc/outboundfeeds/rss/", "category": "Crypto"},
    {"source": "ESPN", "url": "https://www.espn.com/espn/rss/news", "category": "Sports"},
]


@dataclass
class RuntimeContentItem:
    id: str
    content_type: str
    source: str
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
    ) -> None:
        self.cache_ttl_seconds = max(60, int(cache_ttl_seconds))
        self.timeout_seconds = max(1, int(timeout_seconds))
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
            haystack = f"{item.title} {item.summary}".lower()
            score = sum(1 for keyword in keywords if keyword and keyword in haystack)
            if score > 0:
                scored.append((score, item))
        scored.sort(key=lambda entry: (-entry[0], entry[1].published_at or "", entry[1].title))
        return [
            {
                "id": item.id,
                "contentType": item.content_type,
                "source": item.source,
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
        for feed in RSS_FEEDS:
            try:
                response = self._session.get(feed["url"], timeout=self.timeout_seconds)
                response.raise_for_status()
                items.extend(self._parse_feed(response.text, source=feed["source"]))
            except Exception:
                continue
        return items

    def _parse_feed(self, payload: str, *, source: str) -> List[RuntimeContentItem]:
        root = ET.fromstring(payload)
        parsed: List[RuntimeContentItem] = []
        for item in root.findall(".//item")[:25]:
            title = self._find_text(item, "title")
            url = self._find_text(item, "link")
            summary = self._find_text(item, "description")
            published_raw = self._find_text(item, "pubDate")
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
                    title=unescape(title.strip()),
                    url=url.strip(),
                    published_at=published_at,
                    summary=unescape(summary.strip())[:280],
                )
            )
        return parsed

    @staticmethod
    def _find_text(item: ET.Element, tag: str) -> str:
        node = item.find(tag)
        if node is None or node.text is None:
            return ""
        return node.text

    @staticmethod
    def _build_keywords(*, market_title: str, category: str, tags: List[str]) -> List[str]:
        base = [market_title, category, *tags]
        keywords: List[str] = []
        for value in base:
            for piece in str(value or "").lower().replace("?", " ").replace(",", " ").split():
                cleaned = piece.strip()
                if len(cleaned) >= 4 and cleaned not in keywords:
                    keywords.append(cleaned)
        return keywords[:16]
