#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 `trades` 增量同步到面向分析和查询加速的派生表。

目标：
1. 为地址分析生成 `trade_addresses`、`address_trade_daily_stats`、`address_trade_totals`。
2. 为网站查询生成 `market_trade_daily_stats`、`market_latest_prices`。
3. 不直接对超大 `trades` 主表做高风险重 DDL，而是通过增量派生表提速。
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

from db import (  # type: ignore
    DEFAULT_DB_PATH,
    add_db_cli_args,
    configure_db_from_args,
    describe_db_target,
    get_connection,
    init_schema,
)
from db.trade_v2 import get_trade_read_source, sql_identifier, uint256_storage_to_text

TRADE_ANALYTICS_SYNC_KEY = "trade_analytics_sync"
DEFAULT_BATCH_SIZE = 50_000
DEFAULT_WATCH_INTERVAL_SECONDS = 15
FEE_DIVISOR = Decimal("1000000")
ZERO = Decimal("0")
EXCHANGE_ADDRESSES = {
    "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
    "0xc5d563a36ae78145c45a50134d48a1215220f80a",
}
@dataclass
class LatestTradePoint:
    trade_at: Optional[str]
    block_number: Optional[int]
    log_index: Optional[int]
    price: Optional[Decimal]


def _normalize_address(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    return text


def _normalize_side(value: Any) -> str:
    return str(value or "").strip().upper()


def _opposite_side(side: str) -> str:
    normalized = _normalize_side(side)
    if normalized == "BUY":
        return "SELL"
    if normalized == "SELL":
        return "BUY"
    return "UNKNOWN"


def _parse_decimal(value: Any) -> Decimal:
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        return ZERO


def _db_decimal(value: Decimal) -> str:
    return format(value, "f")


def _parse_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_trade_time(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    normalized = text.replace(" UTC", "Z").replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _format_mysql_datetime(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")


def _trade_date_text(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.date().isoformat()


def _is_newer_trade(
    block_number: Optional[int],
    log_index: Optional[int],
    current: Optional[LatestTradePoint],
) -> bool:
    if current is None:
        return True
    current_block = current.block_number if current.block_number is not None else -1
    current_log_index = current.log_index if current.log_index is not None else -1
    next_block = block_number if block_number is not None else -1
    next_log_index = log_index if log_index is not None else -1
    if next_block != current_block:
        return next_block > current_block
    return next_log_index > current_log_index


def _update_sync_state(conn, last_trade_id: int, sync_state_key: str) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO sync_state (`key`, value, last_block, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            sync_state_key,
            str(last_trade_id),
            last_trade_id,
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        ),
    )


def get_last_processed_trade_id(
    db_path: str = DEFAULT_DB_PATH,
    sync_state_key: str = TRADE_ANALYTICS_SYNC_KEY,
) -> int:
    conn = get_connection(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT last_block FROM sync_state WHERE `key` = ?", (sync_state_key,))
        row = cursor.fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    finally:
        conn.close()


def _fetch_trade_batch(conn, last_trade_id: int, batch_size: int) -> List[Dict[str, Any]]:
    trade_read_source = sql_identifier(get_trade_read_source())
    cursor = conn.cursor()
    cursor.execute(
        f"""
        SELECT
            id,
            tx_hash,
            log_index,
            market_id,
            maker,
            taker,
            price,
            size,
            side,
            outcome,
            token_id,
            block_number,
            timestamp,
            fee,
            contract
        FROM {trade_read_source}
        WHERE id > ? AND market_id IS NOT NULL AND market_id > 0
        ORDER BY id ASC
        LIMIT ?
        """,
        (last_trade_id, batch_size),
    )
    rows = cursor.fetchall()
    return [row.as_dict() if hasattr(row, "as_dict") else dict(row) for row in rows]


def _build_trade_address_rows(
    trades: Sequence[Dict[str, Any]],
) -> Tuple[
    List[Tuple[Any, ...]],
    Dict[Tuple[str, int], Dict[str, Any]],
    Dict[str, Dict[str, Any]],
    Dict[Tuple[str, int], Dict[str, Any]],
    Dict[str, Dict[str, Any]],
    Dict[int, Dict[str, Optional[LatestTradePoint]]],
]:
    address_rows: List[Tuple[Any, ...]] = []
    address_daily: Dict[Tuple[str, str], Dict[str, Any]] = {}
    address_totals: Dict[str, Dict[str, Any]] = {}
    address_market: Dict[Tuple[str, int], Dict[str, Any]] = {}
    market_daily: Dict[Tuple[str, int], Dict[str, Any]] = {}
    market_latest: Dict[int, Dict[str, Optional[LatestTradePoint]]] = {}

    for row in trades:
        trade_id = _parse_int(row.get("id"))
        market_id = _parse_int(row.get("market_id"))
        if trade_id is None or market_id is None or market_id <= 0:
            continue

        price = _parse_decimal(row.get("price"))
        size = _parse_decimal(row.get("size"))
        notional = price * size
        fee_raw = _parse_decimal(row.get("fee"))
        fee_amount = fee_raw / FEE_DIVISOR if fee_raw else ZERO

        block_number = _parse_int(row.get("block_number"))
        log_index = _parse_int(row.get("log_index"))
        outcome = str(row.get("outcome") or "").upper() or None

        trade_dt = _parse_trade_time(row.get("timestamp"))
        trade_time = _format_mysql_datetime(trade_dt)
        trade_date = _trade_date_text(trade_dt)
        tx_hash = str(row.get("tx_hash") or "")
        token_id = str(uint256_storage_to_text(row.get("token_id")) or "")
        contract = row.get("contract")
        base_side = _normalize_side(row.get("side"))

        if trade_date:
            market_key = (trade_date, market_id)
            market_entry = market_daily.setdefault(
                market_key,
                {
                    "trade_date": trade_date,
                    "market_id": market_id,
                    "trade_count": 0,
                    "volume_notional": ZERO,
                    "last_trade_at": None,
                    "last_block_number": None,
                },
            )
            market_entry["trade_count"] += 1
            market_entry["volume_notional"] += notional
            if trade_time and (
                market_entry["last_trade_at"] is None or trade_time > market_entry["last_trade_at"]
            ):
                market_entry["last_trade_at"] = trade_time
            if block_number is not None and (
                market_entry["last_block_number"] is None or block_number > market_entry["last_block_number"]
            ):
                market_entry["last_block_number"] = block_number

        latest_entry = market_latest.setdefault(
            market_id,
            {"latest": None, "yes": None, "no": None},
        )
        latest_point = LatestTradePoint(
            trade_at=trade_time,
            block_number=block_number,
            log_index=log_index,
            price=price,
        )
        if _is_newer_trade(block_number, log_index, latest_entry["latest"]):
            latest_entry["latest"] = latest_point
        if outcome == "YES" and _is_newer_trade(block_number, log_index, latest_entry["yes"]):
            latest_entry["yes"] = latest_point
        if outcome == "NO" and _is_newer_trade(block_number, log_index, latest_entry["no"]):
            latest_entry["no"] = latest_point

        participants: List[Tuple[str, str, str, Decimal]] = []
        maker = _normalize_address(row.get("maker"))
        taker = _normalize_address(row.get("taker"))
        if maker and maker not in EXCHANGE_ADDRESSES:
            participants.append((maker, "maker", base_side or "UNKNOWN", fee_amount))
        if taker and taker not in EXCHANGE_ADDRESSES and taker != maker:
            participants.append((taker, "taker", _opposite_side(base_side), ZERO))

        for address, role, side_for_address, address_fee in participants:
            address_rows.append(
                (
                    trade_id,
                    tx_hash,
                    log_index,
                    market_id,
                    token_id,
                    outcome,
                    address,
                    role,
                    side_for_address,
                    _db_decimal(price),
                    _db_decimal(size),
                    _db_decimal(notional),
                    _db_decimal(address_fee),
                    block_number,
                    trade_time,
                    trade_date,
                    contract,
                )
            )

            if trade_date:
                address_daily_key = (trade_date, address)
                address_daily_entry = address_daily.setdefault(
                    address_daily_key,
                    {
                        "trade_date": trade_date,
                        "address": address,
                        "trade_count": 0,
                        "buy_count": 0,
                        "sell_count": 0,
                        "volume_notional": ZERO,
                        "last_trade_at": None,
                    },
                )
                address_daily_entry["trade_count"] += 1
                address_daily_entry["buy_count"] += 1 if side_for_address == "BUY" else 0
                address_daily_entry["sell_count"] += 1 if side_for_address == "SELL" else 0
                address_daily_entry["volume_notional"] += notional
                if trade_time and (
                    address_daily_entry["last_trade_at"] is None or trade_time > address_daily_entry["last_trade_at"]
                ):
                    address_daily_entry["last_trade_at"] = trade_time

            address_total_entry = address_totals.setdefault(
                address,
                {
                    "address": address,
                    "total_trade_count": 0,
                    "total_buy_count": 0,
                    "total_sell_count": 0,
                    "total_volume_notional": ZERO,
                    "first_trade_at": None,
                    "last_trade_at": None,
                },
            )
            address_total_entry["total_trade_count"] += 1
            address_total_entry["total_buy_count"] += 1 if side_for_address == "BUY" else 0
            address_total_entry["total_sell_count"] += 1 if side_for_address == "SELL" else 0
            address_total_entry["total_volume_notional"] += notional
            if trade_time and (
                address_total_entry["first_trade_at"] is None or trade_time < address_total_entry["first_trade_at"]
            ):
                address_total_entry["first_trade_at"] = trade_time
            if trade_time and (
                address_total_entry["last_trade_at"] is None or trade_time > address_total_entry["last_trade_at"]
            ):
                address_total_entry["last_trade_at"] = trade_time

            address_market_key = (address, market_id)
            address_market_entry = address_market.setdefault(
                address_market_key,
                {
                    "address": address,
                    "market_id": market_id,
                    "trade_count": 0,
                    "buy_count": 0,
                    "sell_count": 0,
                    "volume_notional": ZERO,
                    "first_trade_at": None,
                    "last_trade_at": None,
                },
            )
            address_market_entry["trade_count"] += 1
            address_market_entry["buy_count"] += 1 if side_for_address == "BUY" else 0
            address_market_entry["sell_count"] += 1 if side_for_address == "SELL" else 0
            address_market_entry["volume_notional"] += notional
            if trade_time and (
                address_market_entry["first_trade_at"] is None or trade_time < address_market_entry["first_trade_at"]
            ):
                address_market_entry["first_trade_at"] = trade_time
            if trade_time and (
                address_market_entry["last_trade_at"] is None or trade_time > address_market_entry["last_trade_at"]
            ):
                address_market_entry["last_trade_at"] = trade_time

    return (
        address_rows,
        market_daily,
        address_daily,
        address_totals,
        address_market,
        market_latest,
    )


def _insert_trade_addresses(conn, rows: Sequence[Tuple[Any, ...]]) -> None:
    if not rows:
        return
    conn.executemany(
        """
        INSERT OR IGNORE INTO trade_addresses (
            trade_id,
            tx_hash,
            log_index,
            market_id,
            token_id,
            outcome,
            address,
            role,
            side_for_address,
            price,
            size,
            notional,
            fee_amount,
            block_number,
            trade_time,
            trade_date,
            contract
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )


def _upsert_market_daily(conn, entries: Iterable[Dict[str, Any]]) -> None:
    rows = [
        (
            entry["trade_date"],
            entry["market_id"],
            entry["trade_count"],
            _db_decimal(entry["volume_notional"]),
            entry["last_trade_at"],
            entry["last_block_number"],
        )
        for entry in entries
    ]
    if not rows:
        return
    conn.executemany(
        """
        INSERT INTO market_trade_daily_stats (
            trade_date,
            market_id,
            trade_count,
            volume_notional,
            last_trade_at,
            last_block_number
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(trade_date, market_id) DO UPDATE SET
            trade_count = market_trade_daily_stats.trade_count + excluded.trade_count,
            volume_notional = market_trade_daily_stats.volume_notional + excluded.volume_notional,
            last_trade_at = CASE
                WHEN market_trade_daily_stats.last_trade_at IS NULL THEN excluded.last_trade_at
                WHEN excluded.last_trade_at IS NULL THEN market_trade_daily_stats.last_trade_at
                WHEN excluded.last_trade_at > market_trade_daily_stats.last_trade_at THEN excluded.last_trade_at
                ELSE last_trade_at
            END,
            last_block_number = CASE
                WHEN market_trade_daily_stats.last_block_number IS NULL THEN excluded.last_block_number
                WHEN excluded.last_block_number IS NULL THEN market_trade_daily_stats.last_block_number
                WHEN excluded.last_block_number > market_trade_daily_stats.last_block_number THEN excluded.last_block_number
                ELSE last_block_number
            END
        """,
        rows,
    )


def _upsert_address_daily(conn, entries: Iterable[Dict[str, Any]]) -> None:
    rows = [
        (
            entry["trade_date"],
            entry["address"],
            entry["trade_count"],
            entry["buy_count"],
            entry["sell_count"],
            _db_decimal(entry["volume_notional"]),
            entry["last_trade_at"],
        )
        for entry in entries
    ]
    if not rows:
        return
    conn.executemany(
        """
        INSERT INTO address_trade_daily_stats (
            trade_date,
            address,
            trade_count,
            buy_count,
            sell_count,
            volume_notional,
            last_trade_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trade_date, address) DO UPDATE SET
            trade_count = address_trade_daily_stats.trade_count + excluded.trade_count,
            buy_count = address_trade_daily_stats.buy_count + excluded.buy_count,
            sell_count = address_trade_daily_stats.sell_count + excluded.sell_count,
            volume_notional = address_trade_daily_stats.volume_notional + excluded.volume_notional,
            last_trade_at = CASE
                WHEN address_trade_daily_stats.last_trade_at IS NULL THEN excluded.last_trade_at
                WHEN excluded.last_trade_at IS NULL THEN address_trade_daily_stats.last_trade_at
                WHEN excluded.last_trade_at > address_trade_daily_stats.last_trade_at THEN excluded.last_trade_at
                ELSE last_trade_at
            END
        """,
        rows,
    )


def _upsert_address_totals(conn, entries: Iterable[Dict[str, Any]]) -> None:
    rows = [
        (
            entry["address"],
            entry["total_trade_count"],
            entry["total_buy_count"],
            entry["total_sell_count"],
            _db_decimal(entry["total_volume_notional"]),
            entry["first_trade_at"],
            entry["last_trade_at"],
        )
        for entry in entries
    ]
    if not rows:
        return
    conn.executemany(
        """
        INSERT INTO address_trade_totals (
            address,
            total_trade_count,
            total_buy_count,
            total_sell_count,
            total_volume_notional,
            first_trade_at,
            last_trade_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET
            total_trade_count = address_trade_totals.total_trade_count + excluded.total_trade_count,
            total_buy_count = address_trade_totals.total_buy_count + excluded.total_buy_count,
            total_sell_count = address_trade_totals.total_sell_count + excluded.total_sell_count,
            total_volume_notional = address_trade_totals.total_volume_notional + excluded.total_volume_notional,
            first_trade_at = CASE
                WHEN address_trade_totals.first_trade_at IS NULL THEN excluded.first_trade_at
                WHEN excluded.first_trade_at IS NULL THEN address_trade_totals.first_trade_at
                WHEN excluded.first_trade_at < address_trade_totals.first_trade_at THEN excluded.first_trade_at
                ELSE first_trade_at
            END,
            last_trade_at = CASE
                WHEN address_trade_totals.last_trade_at IS NULL THEN excluded.last_trade_at
                WHEN excluded.last_trade_at IS NULL THEN address_trade_totals.last_trade_at
                WHEN excluded.last_trade_at > address_trade_totals.last_trade_at THEN excluded.last_trade_at
                ELSE last_trade_at
            END
        """,
        rows,
    )


def _upsert_address_market(conn, entries: Iterable[Dict[str, Any]]) -> None:
    rows = [
        (
            entry["address"],
            entry["market_id"],
            entry["trade_count"],
            entry["buy_count"],
            entry["sell_count"],
            _db_decimal(entry["volume_notional"]),
            entry["first_trade_at"],
            entry["last_trade_at"],
        )
        for entry in entries
    ]
    if not rows:
        return
    conn.executemany(
        """
        INSERT INTO address_market_stats (
            address,
            market_id,
            trade_count,
            buy_count,
            sell_count,
            volume_notional,
            first_trade_at,
            last_trade_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(address, market_id) DO UPDATE SET
            trade_count = address_market_stats.trade_count + excluded.trade_count,
            buy_count = address_market_stats.buy_count + excluded.buy_count,
            sell_count = address_market_stats.sell_count + excluded.sell_count,
            volume_notional = address_market_stats.volume_notional + excluded.volume_notional,
            first_trade_at = CASE
                WHEN address_market_stats.first_trade_at IS NULL THEN excluded.first_trade_at
                WHEN excluded.first_trade_at IS NULL THEN address_market_stats.first_trade_at
                WHEN excluded.first_trade_at < address_market_stats.first_trade_at THEN excluded.first_trade_at
                ELSE first_trade_at
            END,
            last_trade_at = CASE
                WHEN address_market_stats.last_trade_at IS NULL THEN excluded.last_trade_at
                WHEN excluded.last_trade_at IS NULL THEN address_market_stats.last_trade_at
                WHEN excluded.last_trade_at > address_market_stats.last_trade_at THEN excluded.last_trade_at
                ELSE last_trade_at
            END
        """,
        rows,
    )


def _upsert_market_latest(conn, market_latest: Dict[int, Dict[str, Optional[LatestTradePoint]]]) -> None:
    rows = []
    for market_id, entry in market_latest.items():
        latest = entry.get("latest")
        latest_yes = entry.get("yes")
        latest_no = entry.get("no")
        rows.append(
            (
                market_id,
                latest.trade_at if latest else None,
                latest.block_number if latest else None,
                latest.log_index if latest else None,
                _db_decimal(latest.price) if latest and latest.price is not None else None,
                latest_yes.trade_at if latest_yes else None,
                latest_yes.block_number if latest_yes else None,
                latest_yes.log_index if latest_yes else None,
                _db_decimal(latest_yes.price) if latest_yes and latest_yes.price is not None else None,
                latest_no.trade_at if latest_no else None,
                latest_no.block_number if latest_no else None,
                latest_no.log_index if latest_no else None,
                _db_decimal(latest_no.price) if latest_no and latest_no.price is not None else None,
            )
        )
    if not rows:
        return
    conn.executemany(
        """
        INSERT INTO market_latest_prices (
            market_id,
            latest_trade_at,
            latest_trade_block,
            latest_trade_log_index,
            latest_price,
            latest_yes_trade_at,
            latest_yes_trade_block,
            latest_yes_trade_log_index,
            latest_yes_price,
            latest_no_trade_at,
            latest_no_trade_block,
            latest_no_trade_log_index,
            latest_no_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET
            latest_trade_at = CASE
                WHEN COALESCE(excluded.latest_trade_block, -1) > COALESCE(market_latest_prices.latest_trade_block, -1) THEN excluded.latest_trade_at
                WHEN COALESCE(excluded.latest_trade_block, -1) = COALESCE(market_latest_prices.latest_trade_block, -1)
                     AND COALESCE(excluded.latest_trade_log_index, -1) > COALESCE(market_latest_prices.latest_trade_log_index, -1)
                THEN excluded.latest_trade_at
                ELSE latest_trade_at
            END,
            latest_trade_block = CASE
                WHEN COALESCE(excluded.latest_trade_block, -1) > COALESCE(market_latest_prices.latest_trade_block, -1) THEN excluded.latest_trade_block
                WHEN COALESCE(excluded.latest_trade_block, -1) = COALESCE(market_latest_prices.latest_trade_block, -1)
                     AND COALESCE(excluded.latest_trade_log_index, -1) > COALESCE(market_latest_prices.latest_trade_log_index, -1)
                THEN excluded.latest_trade_block
                ELSE latest_trade_block
            END,
            latest_trade_log_index = CASE
                WHEN COALESCE(excluded.latest_trade_block, -1) > COALESCE(market_latest_prices.latest_trade_block, -1) THEN excluded.latest_trade_log_index
                WHEN COALESCE(excluded.latest_trade_block, -1) = COALESCE(market_latest_prices.latest_trade_block, -1)
                     AND COALESCE(excluded.latest_trade_log_index, -1) > COALESCE(market_latest_prices.latest_trade_log_index, -1)
                THEN excluded.latest_trade_log_index
                ELSE latest_trade_log_index
            END,
            latest_price = CASE
                WHEN COALESCE(excluded.latest_trade_block, -1) > COALESCE(market_latest_prices.latest_trade_block, -1) THEN excluded.latest_price
                WHEN COALESCE(excluded.latest_trade_block, -1) = COALESCE(market_latest_prices.latest_trade_block, -1)
                     AND COALESCE(excluded.latest_trade_log_index, -1) > COALESCE(market_latest_prices.latest_trade_log_index, -1)
                THEN excluded.latest_price
                ELSE latest_price
            END,
            latest_yes_trade_at = CASE
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) > COALESCE(market_latest_prices.latest_yes_trade_block, -1) THEN excluded.latest_yes_trade_at
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) = COALESCE(market_latest_prices.latest_yes_trade_block, -1)
                     AND COALESCE(excluded.latest_yes_trade_log_index, -1) > COALESCE(market_latest_prices.latest_yes_trade_log_index, -1)
                THEN excluded.latest_yes_trade_at
                ELSE latest_yes_trade_at
            END,
            latest_yes_trade_block = CASE
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) > COALESCE(market_latest_prices.latest_yes_trade_block, -1) THEN excluded.latest_yes_trade_block
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) = COALESCE(market_latest_prices.latest_yes_trade_block, -1)
                     AND COALESCE(excluded.latest_yes_trade_log_index, -1) > COALESCE(market_latest_prices.latest_yes_trade_log_index, -1)
                THEN excluded.latest_yes_trade_block
                ELSE latest_yes_trade_block
            END,
            latest_yes_trade_log_index = CASE
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) > COALESCE(market_latest_prices.latest_yes_trade_block, -1) THEN excluded.latest_yes_trade_log_index
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) = COALESCE(market_latest_prices.latest_yes_trade_block, -1)
                     AND COALESCE(excluded.latest_yes_trade_log_index, -1) > COALESCE(market_latest_prices.latest_yes_trade_log_index, -1)
                THEN excluded.latest_yes_trade_log_index
                ELSE latest_yes_trade_log_index
            END,
            latest_yes_price = CASE
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) > COALESCE(market_latest_prices.latest_yes_trade_block, -1) THEN excluded.latest_yes_price
                WHEN COALESCE(excluded.latest_yes_trade_block, -1) = COALESCE(market_latest_prices.latest_yes_trade_block, -1)
                     AND COALESCE(excluded.latest_yes_trade_log_index, -1) > COALESCE(market_latest_prices.latest_yes_trade_log_index, -1)
                THEN excluded.latest_yes_price
                ELSE latest_yes_price
            END,
            latest_no_trade_at = CASE
                WHEN COALESCE(excluded.latest_no_trade_block, -1) > COALESCE(market_latest_prices.latest_no_trade_block, -1) THEN excluded.latest_no_trade_at
                WHEN COALESCE(excluded.latest_no_trade_block, -1) = COALESCE(market_latest_prices.latest_no_trade_block, -1)
                     AND COALESCE(excluded.latest_no_trade_log_index, -1) > COALESCE(market_latest_prices.latest_no_trade_log_index, -1)
                THEN excluded.latest_no_trade_at
                ELSE latest_no_trade_at
            END,
            latest_no_trade_block = CASE
                WHEN COALESCE(excluded.latest_no_trade_block, -1) > COALESCE(market_latest_prices.latest_no_trade_block, -1) THEN excluded.latest_no_trade_block
                WHEN COALESCE(excluded.latest_no_trade_block, -1) = COALESCE(market_latest_prices.latest_no_trade_block, -1)
                     AND COALESCE(excluded.latest_no_trade_log_index, -1) > COALESCE(market_latest_prices.latest_no_trade_log_index, -1)
                THEN excluded.latest_no_trade_block
                ELSE latest_no_trade_block
            END,
            latest_no_trade_log_index = CASE
                WHEN COALESCE(excluded.latest_no_trade_block, -1) > COALESCE(market_latest_prices.latest_no_trade_block, -1) THEN excluded.latest_no_trade_log_index
                WHEN COALESCE(excluded.latest_no_trade_block, -1) = COALESCE(market_latest_prices.latest_no_trade_block, -1)
                     AND COALESCE(excluded.latest_no_trade_log_index, -1) > COALESCE(market_latest_prices.latest_no_trade_log_index, -1)
                THEN excluded.latest_no_trade_log_index
                ELSE latest_no_trade_log_index
            END,
            latest_no_price = CASE
                WHEN COALESCE(excluded.latest_no_trade_block, -1) > COALESCE(market_latest_prices.latest_no_trade_block, -1) THEN excluded.latest_no_price
                WHEN COALESCE(excluded.latest_no_trade_block, -1) = COALESCE(market_latest_prices.latest_no_trade_block, -1)
                     AND COALESCE(excluded.latest_no_trade_log_index, -1) > COALESCE(market_latest_prices.latest_no_trade_log_index, -1)
                THEN excluded.latest_no_price
                ELSE latest_no_price
            END
        """,
        rows,
    )


def sync_trade_analytics(
    db_path: str = DEFAULT_DB_PATH,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_batches: Optional[int] = None,
    sync_state_key: str = TRADE_ANALYTICS_SYNC_KEY,
    include_trade_addresses: bool = False,
    verbose: bool = True,
) -> Dict[str, int]:
    init_schema(db_path=db_path)

    conn = get_connection(db_path)
    batches = 0
    processed_trades = 0
    last_trade_id = get_last_processed_trade_id(db_path=db_path, sync_state_key=sync_state_key)
    latest_seen_trade_id = last_trade_id

    try:
        while True:
            if max_batches is not None and batches >= max_batches:
                break

            trades = _fetch_trade_batch(conn, latest_seen_trade_id, batch_size)
            if not trades:
                break

            (
                address_rows,
                market_daily,
                address_daily,
                address_totals,
                address_market,
                market_latest,
            ) = _build_trade_address_rows(trades)

            if include_trade_addresses:
                _insert_trade_addresses(conn, address_rows)
            _upsert_market_daily(conn, market_daily.values())
            _upsert_address_daily(conn, address_daily.values())
            _upsert_address_totals(conn, address_totals.values())
            _upsert_address_market(conn, address_market.values())
            _upsert_market_latest(conn, market_latest)

            latest_seen_trade_id = max(_parse_int(row.get("id")) or latest_seen_trade_id for row in trades)
            _update_sync_state(conn, latest_seen_trade_id, sync_state_key)
            conn.commit()

            processed_trades += len(trades)
            batches += 1
            if verbose:
                print(
                    f"[trade-analytics] batch={batches} processed={processed_trades} last_trade_id={latest_seen_trade_id}",
                    file=sys.stderr,
                )

        return {
            "batches": batches,
            "processed_trades": processed_trades,
            "last_trade_id": latest_seen_trade_id,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync trade analytics/materialized tables from trades")
    add_db_cli_args(parser)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="每批处理多少条 trades")
    parser.add_argument("--max-batches", type=int, default=None, help="最多处理多少批；默认直到追平")
    parser.add_argument("--sync-state-key", default=TRADE_ANALYTICS_SYNC_KEY, help="sync_state 中记录处理进度的 key")
    parser.add_argument("--with-trade-addresses", action="store_true", help="额外落全量 trade_addresses 明细表；更占磁盘")
    parser.add_argument("--watch", action="store_true", help="持续监控并按间隔重复增量同步")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_WATCH_INTERVAL_SECONDS,
        help=f"--watch 模式下两次同步之间的间隔秒数（默认 {DEFAULT_WATCH_INTERVAL_SECONDS}）",
    )

    args = parser.parse_args()
    configure_db_from_args(args)
    db_path = args.sqlite_path

    print(f"[trade-analytics] target={describe_db_target()}", file=sys.stderr)
    interval_seconds = max(1, int(args.interval))

    try:
        while True:
            started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            print(f"[trade-analytics] cycle-start started_at={started_at}", file=sys.stderr)
            result = sync_trade_analytics(
                db_path=db_path,
                batch_size=args.batch_size,
                max_batches=args.max_batches,
                sync_state_key=args.sync_state_key,
                include_trade_addresses=args.with_trade_addresses,
                verbose=True,
            )
            print(
                f"[trade-analytics] cycle-done batches={result['batches']} processed={result['processed_trades']} last_trade_id={result['last_trade_id']}",
                file=sys.stderr,
            )

            if not args.watch:
                break

            print(
                f"[trade-analytics] sleeping interval_seconds={interval_seconds}",
                file=sys.stderr,
            )
            time.sleep(interval_seconds)
    except KeyboardInterrupt:
        print("[trade-analytics] interrupted, exiting", file=sys.stderr)


if __name__ == "__main__":
    main()
