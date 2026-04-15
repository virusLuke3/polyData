from __future__ import annotations

import time
from typing import Any, Dict, Iterable, List, Optional


def query_all(ctx: dict, sql: str, params: Optional[Iterable[Any]] = None) -> List[Dict[str, Any]]:
    conn = ctx["get_connection"](ctx["DB_PATH"])
    cursor = conn.cursor()
    bound_params = tuple(params or ())
    try:
        cursor.execute(sql, bound_params)
        return [ctx["dict_from_row"](row) for row in cursor.fetchall()]
    except Exception:
        ctx["app"].logger.exception("SQL query_all failed sql=%s params=%s", " ".join(sql.split()), bound_params)
        raise
    finally:
        conn.close()


def query_one(ctx: dict, sql: str, params: Optional[Iterable[Any]] = None) -> Dict[str, Any]:
    conn = ctx["get_connection"](ctx["DB_PATH"])
    cursor = conn.cursor()
    bound_params = tuple(params or ())
    try:
        cursor.execute(sql, bound_params)
        return ctx["dict_from_row"](cursor.fetchone())
    except Exception:
        ctx["app"].logger.exception("SQL query_one failed sql=%s params=%s", " ".join(sql.split()), bound_params)
        raise
    finally:
        conn.close()


def table_exists(ctx: dict, table_name: str) -> bool:
    conn = ctx["get_connection"](ctx["DB_PATH"])
    cursor = conn.cursor()
    try:
        if ctx["get_backend"]() == "sqlite":
            cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", (table_name,))
            return cursor.fetchone() is not None
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = %s
            LIMIT 1
            """,
            (table_name,),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def identifier_name(identifier: str) -> str:
    return str(identifier or "").strip().strip("`")


def get_existing_trade_read_source(ctx: dict) -> Optional[str]:
    for candidate in (ctx["TRADE_V2_CORE_TABLE"], ctx["TRADE_READ_SOURCE"], ctx["LEGACY_TRADES_TABLE"]):
        table_name = identifier_name(candidate)
        if table_name and table_exists(ctx, table_name):
            return ctx["sql_identifier"](table_name)
    return None


def get_trades_index_names(ctx: dict, force_refresh: bool = False) -> set[str]:
    if ctx["get_backend"]() != "mysql":
        return set()
    index_table = (
        ctx["ADDRESS_HISTORY_SOURCE"]
        if ctx["ADDRESS_HISTORY_SOURCE"] in {ctx["LEGACY_TRADES_TABLE"], ctx["TRADE_V2_CORE_TABLE"]}
        else ctx["LEGACY_TRADES_TABLE"]
    )
    if (
        not force_refresh
        and ctx["_trade_index_cache"].get("names")
        and time.monotonic() - ctx["_trade_index_cache"].get("loaded_at", 0.0) < 60
    ):
        return set(ctx["_trade_index_cache"]["names"])

    with ctx["_trade_index_cache_lock"]:
        if (
            not force_refresh
            and ctx["_trade_index_cache"].get("names")
            and time.monotonic() - ctx["_trade_index_cache"].get("loaded_at", 0.0) < 60
        ):
            return set(ctx["_trade_index_cache"]["names"])
        conn = ctx["get_connection"](ctx["DB_PATH"])
        try:
            cursor = conn.cursor()
            cursor.execute(f"SHOW INDEX FROM {index_table}")
            index_names = {row[2] for row in cursor.fetchall()}
            ctx["_trade_index_cache"]["names"] = index_names
            ctx["_trade_index_cache"]["loaded_at"] = time.monotonic()
            return set(index_names)
        finally:
            conn.close()
