from __future__ import annotations

import os
import time
from typing import Any, Dict, Iterable, List, Optional


MYSQL_PROTOCOL_ERROR_CODES = {1156, 1158, 1159, 1160, 1161, 2006, 2013, 2014}
MYSQL_PROTOCOL_ERROR_MARKERS = (
    "packet sequence number wrong",
    "lost connection to mysql server",
    "mysql server has gone away",
    "commands out of sync",
    "malformed packet",
    "packets out of order",
)


def is_mysql_protocol_error(exc: BaseException) -> bool:
    args = getattr(exc, "args", ())
    if args and isinstance(args[0], int) and args[0] in MYSQL_PROTOCOL_ERROR_CODES:
        return True
    message = str(exc).lower()
    return any(marker in message for marker in MYSQL_PROTOCOL_ERROR_MARKERS)


def exit_worker_on_mysql_protocol_error(ctx: dict, exc: BaseException, operation: str) -> None:
    if not is_mysql_protocol_error(exc):
        return
    ctx["app"].logger.critical(
        "mysql protocol/connection state is unhealthy during %s; exiting current worker for gunicorn respawn: %r",
        operation,
        exc,
    )
    os._exit(75)


def query_all(ctx: dict, sql: str, params: Optional[Iterable[Any]] = None) -> List[Dict[str, Any]]:
    conn = ctx["get_connection"](ctx["DB_PATH"])
    cursor = conn.cursor()
    bound_params = tuple(params or ())
    try:
        cursor.execute(sql, bound_params)
        return [ctx["dict_from_row"](row) for row in cursor.fetchall()]
    except Exception as exc:
        ctx["app"].logger.exception("SQL query_all failed sql=%s params=%s", " ".join(sql.split()), bound_params)
        exit_worker_on_mysql_protocol_error(ctx, exc, "query_all")
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
    except Exception as exc:
        ctx["app"].logger.exception("SQL query_one failed sql=%s params=%s", " ".join(sql.split()), bound_params)
        exit_worker_on_mysql_protocol_error(ctx, exc, "query_one")
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
    except Exception as exc:
        ctx["app"].logger.exception("SQL table_exists failed table=%s", table_name)
        exit_worker_on_mysql_protocol_error(ctx, exc, "table_exists")
        raise
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
        except Exception as exc:
            ctx["app"].logger.exception("SQL get_trades_index_names failed table=%s", index_table)
            exit_worker_on_mysql_protocol_error(ctx, exc, "get_trades_index_names")
            raise
        finally:
            conn.close()
