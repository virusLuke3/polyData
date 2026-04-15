#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SQLite-backed snapshot cache for panel-friendly API payloads."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional


class SnapshotStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = str(Path(db_path).expanduser())
        self._lock = threading.Lock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        path = Path(self.db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            conn = self._connect()
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS panel_snapshots (
                        namespace TEXT NOT NULL,
                        cache_key TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL,
                        expires_at INTEGER NOT NULL,
                        PRIMARY KEY (namespace, cache_key)
                    )
                    """
                )
                conn.commit()
                self._initialized = True
            finally:
                conn.close()

    def get(self, namespace: str, cache_key: str) -> Optional[Any]:
        self._ensure_schema()
        now = int(time.time())
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT payload_json, expires_at
                FROM panel_snapshots
                WHERE namespace = ? AND cache_key = ?
                LIMIT 1
                """,
                (namespace, cache_key),
            ).fetchone()
            if row is None:
                return None
            if int(row["expires_at"] or 0) <= now:
                conn.execute(
                    "DELETE FROM panel_snapshots WHERE namespace = ? AND cache_key = ?",
                    (namespace, cache_key),
                )
                conn.commit()
                return None
            return json.loads(str(row["payload_json"]))
        finally:
            conn.close()

    def get_stale(self, namespace: str, cache_key: str) -> Optional[Any]:
        self._ensure_schema()
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT payload_json
                FROM panel_snapshots
                WHERE namespace = ? AND cache_key = ?
                LIMIT 1
                """,
                (namespace, cache_key),
            ).fetchone()
            if row is None:
                return None
            return json.loads(str(row["payload_json"]))
        finally:
            conn.close()

    def set(self, namespace: str, cache_key: str, payload: Any, ttl_seconds: int) -> None:
        self._ensure_schema()
        now = int(time.time())
        expires_at = now + max(1, int(ttl_seconds))
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO panel_snapshots(namespace, cache_key, payload_json, updated_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(namespace, cache_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at,
                    expires_at = excluded.expires_at
                """,
                (namespace, cache_key, json.dumps(payload, ensure_ascii=True, default=str), now, expires_at),
            )
            conn.commit()
        finally:
            conn.close()
