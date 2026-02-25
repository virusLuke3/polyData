#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Polymarket 索引器数据库模块

功能：数据库 schema 定义、连接管理、表创建
支持 SQLite，用于 markets、trades、sync_state 表
"""

import sqlite3
import os
from pathlib import Path
from typing import Optional
from contextlib import contextmanager

# 默认数据库路径：仓库根目录下的 database/polymarket_indexer.db
_repo_root = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_PATH = str(_repo_root / "database" / "polymarket_indexer.db")


def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """获取数据库连接"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row  # 返回字典形式
    return conn


@contextmanager
def get_db(db_path: str = DEFAULT_DB_PATH):
    """上下文管理器，自动提交/回滚"""
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_schema(conn: Optional[sqlite3.Connection] = None, db_path: str = DEFAULT_DB_PATH) -> None:
    """
    初始化数据库 schema
    
    创建 markets、trades、sync_state 三张表
    """
    close_after = False
    if conn is None:
        conn = get_connection(db_path)
        close_after = True
    
    try:
        cursor = conn.cursor()
        
        # markets 表 - 市场基本信息（含 category、tags；不含 collateral_token/status/updated_at）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS markets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE,
                condition_id TEXT NOT NULL UNIQUE,
                question_id TEXT,
                oracle TEXT,
                yes_token_id TEXT NOT NULL,
                no_token_id TEXT NOT NULL,
                title TEXT,
                description TEXT,
                enable_neg_risk INTEGER DEFAULT 0,
                end_date TEXT,
                created_at TEXT,
                category TEXT,
                tags TEXT
            )
        """)
        # 兼容旧库：为已有表补充 category、tags 列
        for col in ("category", "tags"):
            try:
                cursor.execute(f"ALTER TABLE markets ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_markets_condition_id ON markets(condition_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_markets_yes_token ON markets(yes_token_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_markets_no_token ON markets(no_token_id)")
        
        # trades 表 - 交易记录
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tx_hash TEXT NOT NULL,
                log_index INTEGER NOT NULL,
                market_id INTEGER NOT NULL,
                maker TEXT NOT NULL,
                taker TEXT NOT NULL,
                price TEXT NOT NULL,
                size TEXT NOT NULL,
                side TEXT NOT NULL,
                outcome TEXT,
                token_id TEXT NOT NULL,
                block_number INTEGER,
                timestamp TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (market_id) REFERENCES markets(id),
                UNIQUE(tx_hash, log_index)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trades_block ON trades(block_number)")

        # 启用 WAL 模式，提升批量写入性能，减轻长运行时的 IO 压力
        cursor.execute("PRAGMA journal_mode=WAL")
        
        # sync_state 表 - 同步进度
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT,
                last_block INTEGER,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()
    finally:
        if close_after:
            conn.close()


def dict_from_row(row: sqlite3.Row) -> dict:
    """将 sqlite3.Row 转为字典"""
    return dict(row) if row else {}
