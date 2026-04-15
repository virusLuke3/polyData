from __future__ import annotations

from typing import Any, Dict


def build_system_health_payload(ctx: dict) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "database": ctx["describe_db_target"](),
        "redis": bool(ctx["get_redis_client"]()),
        "apiStatus": "ok",
        "lobRuntime": {"status": "ready", "mode": "memory"},
        "contentSync": {"status": "runtime-rss" if not ctx["table_exists"]("content_items") else "database"},
    }
    if not ctx["table_exists"]("sync_state"):
        payload["syncState"] = {}
        return payload

    sync_rows = ctx["query_all"](
        """
        SELECT `key`, value, last_block, updated_at
        FROM sync_state
        WHERE `key` IN (?, ?, ?, ?, ?, ?)
        ORDER BY updated_at DESC
        """,
        (
            "market_sync",
            "trade_sync",
            "oracle_sync",
            "market_sync_live",
            "trade_sync_live",
            "oracle_sync_live",
        ),
    )
    sync_state = {}
    for row in sync_rows:
        sync_state[row.get("key")] = {
            "value": row.get("value"),
            "lastBlock": row.get("last_block"),
            "updatedAt": row.get("updated_at"),
        }
    payload["syncState"] = sync_state
    payload["marketSync"] = sync_state.get("market_sync_live") or sync_state.get("market_sync")
    payload["tradeSync"] = sync_state.get("trade_sync_live") or sync_state.get("trade_sync")
    payload["oracleSync"] = sync_state.get("oracle_sync_live") or sync_state.get("oracle_sync")
    payload["priceSync"] = {
        "status": "derived-from-trades",
        "updatedAt": ctx["query_one"]("SELECT MAX(latest_trade_at) AS updated_at FROM market_latest_prices").get("updated_at")
        if ctx["table_exists"]("market_latest_prices")
        else None,
    }
    return payload

