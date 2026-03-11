#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
阶段二 - 任务 B: Trades Indexer

功能：扫描指定区块范围内的 OrderFilled 事件，解码交易，写入数据库
支持断点续传、动态市场发现、指数退避重试。
"""

import json
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple
from decimal import Decimal

# 保证 scripts 根目录在 path 中，以便 from db / config / market 可导入
_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    from web3 import Web3
except ImportError as e:
    print("Error: web3 not installed or wrong Python env.", file=sys.stderr)
    print("  Run: pip install web3>=6.0.0", file=sys.stderr)
    print("  If using conda, ensure env is activated: conda activate polyBots", file=sys.stderr)
    print(f"  Detail: {e}", file=sys.stderr)
    sys.exit(1)
try:
    # 兼容 Web3.py v6.11+ 和 v7 版本
    from web3.middleware import ExtraDataToPOAMiddleware as geth_poa_middleware
except ImportError:
    try:
        # 兼容旧版 Web3.py
        from web3.middleware import geth_poa_middleware
    except ImportError:
        try:
            from web3.middleware.geth_poa import geth_poa_middleware
        except ImportError:
            geth_poa_middleware = None
            print("Warning: POA middleware not found; will use raw RPC for block timestamp.", file=sys.stderr)

from db import add_db_cli_args, configure_db_from_args, describe_db_target, get_connection, init_schema, dict_from_row, DEFAULT_DB_PATH
from market.market_discovery import fetch_and_upsert_markets_for_token_ids
from trade.trade_decoder import decode_order_filled_log, CTF_EXCHANGE_ADDRESS, NEG_RISK_EXCHANGE_ADDRESS
from config import get_rpc_url

USDC_DIVISOR = 10**6
SYNC_STATE_KEY = "trade_sync"
BATCH_BLOCKS = 5000
MAX_RETRIES = 5
RETRY_DELAY_BASE = 2
MAX_WORKERS = 20
TOKEN_ID_BACKFILL_MAX_PAGES = 10
TRADE_INSERT_BATCH_SIZE = 2000
SQLITE_IN_MAX_VARS = 900
_THREAD_LOCAL = threading.local()


def iter_block_windows(from_block: int, to_block: int, window_blocks: int):
    current = from_block
    while current <= to_block:
        end = min(current + window_blocks - 1, to_block)
        yield current, end
        current = end + 1


def _build_web3(rpc_url: str) -> Web3:
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if geth_poa_middleware is not None:
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to RPC: {rpc_url}")
    return w3


def _get_thread_local_web3(rpc_url: str) -> Web3:
    cache = getattr(_THREAD_LOCAL, "web3_cache", None)
    if cache is None:
        cache = {}
        _THREAD_LOCAL.web3_cache = cache
    w3 = cache.get(rpc_url)
    if w3 is None:
        w3 = _build_web3(rpc_url)
        cache[rpc_url] = w3
    return w3


def _invalidate_thread_local_web3(rpc_url: str) -> None:
    cache = getattr(_THREAD_LOCAL, "web3_cache", None)
    if not cache:
        return
    w3 = cache.pop(rpc_url, None)
    provider = getattr(w3, "provider", None) if w3 is not None else None
    if provider is not None:
        try:
            session = getattr(provider, "_request_session_manager", None)
            if session is not None and hasattr(session, "cache_and_return_session"):
                pass
        except Exception:
            pass


def _format_rpc_error(exc: Exception, max_len: int = 240) -> str:
    text = " ".join(str(exc).split())
    markers = (
        " because of Unterminated string",
        " because of Expecting value",
        " because of JSONDecodeError",
    )
    for marker in markers:
        idx = text.find(marker)
        if idx > 0:
            text = text[idx + 12 :]
            break
    if len(text) > max_len:
        text = text[:max_len] + "..."
    return text


def _should_split_range(exc: Exception, from_block: int, to_block: int) -> bool:
    if from_block >= to_block:
        return False
    msg = str(exc).lower()
    return any(
        keyword in msg
        for keyword in (
            "unterminated string",
            "json",
            "response ended",
            "expecting value",
            "413",
            "payload",
            "too large",
            "timed out",
            "read timed out",
        )
    )


def get_order_filled_topic(w3: Web3) -> bytes:
    sig = "OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)"
    return w3.keccak(text=sig)


def fetch_logs_with_retry(
    rpc_url: str,
    from_block: int,
    to_block: int,
) -> List[Dict]:
    """带指数退避的 getLogs"""
    addresses = [
        Web3.to_checksum_address(CTF_EXCHANGE_ADDRESS),
        Web3.to_checksum_address(NEG_RISK_EXCHANGE_ADDRESS),
    ]
    last_err: Optional[Exception] = None
    
    for attempt in range(MAX_RETRIES):
        try:
            w3 = _get_thread_local_web3(rpc_url)
            topic = get_order_filled_topic(w3)
            logs = w3.eth.get_logs(
                {
                    "address": addresses,
                    "topics": [topic],
                    "fromBlock": from_block,
                    "toBlock": to_block,
                }
            )
            return [dict(log) for log in logs]
        except Exception as e:
            last_err = e
            _invalidate_thread_local_web3(rpc_url)
            delay = RETRY_DELAY_BASE ** (attempt + 1)
            print(
                f"getLogs failed blocks {from_block}-{to_block} "
                f"(attempt {attempt+1}/{MAX_RETRIES}): {_format_rpc_error(e)}, retry in {delay}s",
                file=sys.stderr,
            )
            time.sleep(delay)

    if last_err is not None and _should_split_range(last_err, from_block, to_block):
        mid = (from_block + to_block) // 2
        print(
            f"getLogs failed repeatedly for blocks {from_block}-{to_block}; split into {from_block}-{mid} and {mid + 1}-{to_block}",
            file=sys.stderr,
        )
        left = fetch_logs_with_retry(rpc_url, from_block, mid)
        right = fetch_logs_with_retry(rpc_url, mid + 1, to_block)
        return left + right
    return []


def fetch_logs_parallel_with_retry(
    rpc_url: str,
    from_block: int,
    to_block: int,
    batch_blocks: int = BATCH_BLOCKS,
    max_workers: int = MAX_WORKERS,
) -> List[Dict]:
    """并发批量抓取 OrderFilled 日志，风格对齐 oracle 抓取器。"""
    ranges = []
    current = from_block
    while current <= to_block:
        end = min(current + batch_blocks - 1, to_block)
        ranges.append((current, end))
        current = end + 1

    total_tasks = len(ranges)
    print(
        f"  ... 任务已切分为 {total_tasks} 个并发批次 (每批 {batch_blocks} 块)，启动 {max_workers} 个工作线程...",
        file=sys.stderr,
    )

    logs: List[Dict] = []
    completed_tasks = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_range = {executor.submit(fetch_logs_with_retry, rpc_url, r[0], r[1]): r for r in ranges}
        for future in as_completed(future_to_range):
            res = future.result()
            if res:
                logs.extend(res)
            completed_tasks += 1
            if completed_tasks % max(1, total_tasks // 20) == 0 or completed_tasks == total_tasks:
                progress = (completed_tasks / total_tasks) * 100
                print(
                    f"  ---> 抓取进度: {completed_tasks}/{total_tasks} 批次 ({progress:.1f}%) | 累计日志: {len(logs)} 条",
                    file=sys.stderr,
                )

    logs.sort(key=lambda x: (x.get("blockNumber", 0), x.get("logIndex", 0)))
    return logs


def get_block_timestamp(w3: Web3, block_number: int, max_retries: int = 3) -> Optional[str]:
    """查询区块时间戳，带重试。POA 链解析失败时用原始 RPC 只取 timestamp。"""
    hex_block = hex(block_number)
    for attempt in range(max_retries):
        try:
            block = w3.eth.get_block(block_number)
            if block is None:
                if attempt < max_retries - 1:
                    time.sleep(RETRY_DELAY_BASE ** (attempt + 1))
                continue
            ts = block.get("timestamp")
            if ts is not None:
                return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")
        except Exception:
            # POA 链 extraData 解析失败时，用原始 RPC 只取 timestamp，绕过区块对象校验
            try:
                # 优先用 provider，部分版本为 manager
                maker = getattr(w3, "provider", None) or getattr(w3, "manager", None)
                if maker and hasattr(maker, "make_request"):
                    raw = maker.make_request("eth_getBlockByNumber", [hex_block, False])
                else:
                    raw = None
                if raw and raw.get("result"):
                    ts_hex = raw["result"].get("timestamp")
                    if ts_hex is not None:
                        ts = int(ts_hex, 16) if isinstance(ts_hex, str) else int(ts_hex)
                        return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")
            except Exception:
                pass
            if attempt < max_retries - 1:
                time.sleep(RETRY_DELAY_BASE ** (attempt + 1))
            else:
                pass  # 已尝试 raw RPC，不再刷屏
    return None


def prefetch_block_timestamps(
    conn,
    rpc_url: str,
    logs: List[Dict],
    block_ts_cache: Dict[int, str],
    max_workers: int = MAX_WORKERS,
) -> None:
    unique_blocks = list({log["blockNumber"] for log in logs if "blockNumber" in log and log["blockNumber"] not in block_ts_cache})
    if not unique_blocks:
        return

    cursor = conn.cursor()
    for chunk_start in range(0, len(unique_blocks), SQLITE_IN_MAX_VARS):
        block_chunk = unique_blocks[chunk_start:chunk_start + SQLITE_IN_MAX_VARS]
        placeholders = ",".join("?" for _ in block_chunk)
        cursor.execute(
            f"SELECT block_number, timestamp FROM block_timestamps WHERE block_number IN ({placeholders})",
            block_chunk,
        )
        cached_rows = cursor.fetchall()
        for row in cached_rows:
            block_ts_cache[int(row["block_number"])] = row["timestamp"]

    missing_blocks = [block for block in unique_blocks if block not in block_ts_cache]
    if not missing_blocks:
        print(
            f"  ... 区块时间戳全部命中本地缓存 ({len(unique_blocks)} 个区块)...",
            file=sys.stderr,
        )
        return

    print(
        f"  ... 准备预取 {len(missing_blocks)} 个独立区块的时间戳 ({len(unique_blocks) - len(missing_blocks)} 个命中本地缓存, {max_workers}线程并发)...",
        file=sys.stderr,
    )

    def _fetch_ts(block_number: int):
        w3 = _get_thread_local_web3(rpc_url)
        return block_number, get_block_timestamp(w3, block_number)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_block = {executor.submit(_fetch_ts, b): b for b in missing_blocks}
        completed = 0
        rows_to_persist = []
        for future in as_completed(future_to_block):
            block_number, ts = future.result()
            block_ts_cache[block_number] = ts or ""
            if ts:
                rows_to_persist.append((block_number, ts))
            completed += 1
            if completed % max(1, len(missing_blocks) // 10) == 0 or completed == len(missing_blocks):
                progress = (completed / len(missing_blocks)) * 100
                print(
                    f"  ---> 区块时间预取进度: {completed}/{len(missing_blocks)} ({progress:.1f}%)",
                    file=sys.stderr,
                )

    if rows_to_persist:
        cursor.executemany(
            "INSERT OR REPLACE INTO block_timestamps (block_number, timestamp) VALUES (?, ?)",
            rows_to_persist,
        )


def find_market_by_token_id(conn, token_id: str) -> Optional[Dict]:
    """根据 tokenId 查找市场"""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM markets WHERE yes_token_id = ? OR no_token_id = ? LIMIT 1",
        (str(token_id), str(token_id)),
    )
    row = cursor.fetchone()
    return dict_from_row(row) if row else None


def resolve_market_by_token_id(
    conn,
    token_id: str,
    db_path: str,
    backfill_attempted: set,
    enable_market_backfill: bool = True,
) -> Optional[Dict]:
    market = find_market_by_token_id(conn, token_id)
    if market or token_id in backfill_attempted or not enable_market_backfill:
        return market

    backfill_attempted.add(token_id)
    try:
        conn.commit()
        inserted = fetch_and_upsert_markets_for_token_ids(
            [token_id],
            db_path=db_path,
            max_pages=TOKEN_ID_BACKFILL_MAX_PAGES,
            requests_delay=0.0,
        )
        if inserted:
            print(
                f"Backfilled {inserted} market(s) for tokenId {token_id[:30]}...",
                file=sys.stderr,
            )
    except Exception as e:
        print(f"Failed to backfill market for tokenId {token_id[:30]}...: {e}", file=sys.stderr)

    return find_market_by_token_id(conn, token_id)


def decode_and_enrich(log: Dict, w3: Web3, block_ts_cache: Dict[int, str]) -> Optional[Dict]:
    """解码日志并补充 block_number、timestamp、size"""
    decoded = decode_order_filled_log(log, w3)
    if not decoded:
        return None
    
    block_num = log.get("blockNumber")
    if block_num is not None:
        decoded["block_number"] = block_num
        if block_num not in block_ts_cache:
            block_ts_cache[block_num] = get_block_timestamp(w3, block_num)
        decoded["timestamp"] = block_ts_cache.get(block_num)
    
    # size = 成交的头寸代币数量（实际单位，除以1e6）
    tid = str(decoded.get("tokenId", ""))
    maker_asset = str(decoded.get("makerAssetId", ""))
    taker_asset = str(decoded.get("takerAssetId", ""))
    if tid == maker_asset:
        token_amount = int(decoded.get("makerAmountFilled", 0) or 0)
    else:
        token_amount = int(decoded.get("takerAmountFilled", 0) or 0)
    decoded["size"] = str(Decimal(token_amount) / Decimal(USDC_DIVISOR))
    
    return decoded


def build_trade_insert_row(trade: Dict, market_id: int, outcome: str) -> Tuple:
    return (
        trade["txHash"],
        trade["logIndex"],
        market_id,
        str(trade["maker"]),
        str(trade["taker"]),
        trade["price"],
        trade["size"],
        trade["side"],
        outcome,
        trade["tokenId"],
        trade.get("block_number"),
        trade.get("timestamp"),
        trade.get("orderHash"),
        trade.get("makerAssetId"),
        trade.get("takerAssetId"),
        int(trade["makerAmountFilled"]) if trade.get("makerAmountFilled") is not None else None,
        int(trade["takerAmountFilled"]) if trade.get("takerAmountFilled") is not None else None,
        int(trade["fee"]) if trade.get("fee") is not None else None,
        trade.get("contract") or trade.get("exchange"),
    )


def insert_trades_batch(conn, trade_rows: List[Tuple]) -> int:
    """批量插入交易记录，唯一键冲突时忽略（幂等）"""
    if not trade_rows:
        return 0

    cursor = conn.cursor()
    before_changes = conn.total_changes
    try:
        cursor.executemany(
            """
            INSERT OR IGNORE INTO trades (
                tx_hash, log_index, market_id, maker, taker, price, size,
                side, outcome, token_id, block_number, timestamp,
                order_hash, maker_asset_id, taker_asset_id,
                maker_amount, taker_amount, fee, contract
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            trade_rows,
        )
        return conn.total_changes - before_changes
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise RuntimeError(
            f"Insert trades batch failed for {len(trade_rows)} rows: {e}"
        ) from e


def update_sync_state(conn, block_number: int, sync_state_key: str = SYNC_STATE_KEY) -> None:
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO sync_state (key, value, last_block, updated_at) VALUES (?, ?, ?, ?)",
        (
            sync_state_key,
            str(block_number),
            block_number,
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        ),
    )


def run_indexer(
    from_block: int,
    to_block: int,
    rpc_url: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH,
    output_json: Optional[str] = None,
    batch_blocks: int = BATCH_BLOCKS,
    max_workers: int = MAX_WORKERS,
    sync_state_key: str = SYNC_STATE_KEY,
    update_sync_state_on_commit: bool = True,
    enable_market_backfill: bool = True,
) -> Tuple[int, int]:
    """
    扫描 from_block 到 to_block 的 OrderFilled 日志，解码并写入数据库或 JSON 文件

    Args:
        output_json: 若指定，则写入该 JSON 文件而非数据库（测试模式）

    Returns:
        (处理日志数, 新插入交易数或输出的交易数)
    """
    if rpc_url is None:
        rpc_url = get_rpc_url()
    test_mode = output_json is not None
    init_schema(db_path=db_path)

    w3 = _build_web3(rpc_url)

    conn = get_connection(db_path)
    inserted = 0
    processed = 0
    unknown_tokens = set()
    backfill_attempted = set()
    trades_out: List[Dict] = []  # 测试模式收集
    window_blocks = max(batch_blocks, batch_blocks * max_workers)
    total_blocks = max(0, to_block - from_block + 1)
    completed_blocks = 0

    try:
        print(
            f"Streaming logs blocks {from_block}-{to_block} with window={window_blocks}, batch={batch_blocks}, workers={max_workers}...",
            file=sys.stderr,
            flush=True,
        )

        for window_index, (window_start, window_end) in enumerate(
            iter_block_windows(from_block, to_block, window_blocks),
            start=1,
        ):
            block_ts_cache: Dict[int, str] = {}
            pending_trade_rows: List[Tuple] = []
            print(
                f"Window {window_index}: fetch logs blocks {window_start}-{window_end}...",
                file=sys.stderr,
                flush=True,
            )
            logs = fetch_logs_parallel_with_retry(
                rpc_url,
                window_start,
                window_end,
                batch_blocks=batch_blocks,
                max_workers=max_workers,
            )

            if logs:
                prefetch_block_timestamps(conn, rpc_url, logs, block_ts_cache, max_workers=max_workers)

            print(f"  ... 开始解析并写入当前窗口 {len(logs)} 条日志...", file=sys.stderr)
            for idx, log in enumerate(logs, start=1):
                processed += 1
                decoded = decode_and_enrich(log, w3, block_ts_cache)
                if not decoded:
                    continue

                token_id = str(decoded["tokenId"])
                market = resolve_market_by_token_id(
                    conn,
                    token_id,
                    db_path,
                    backfill_attempted,
                    enable_market_backfill=enable_market_backfill,
                )

                if not market and token_id not in unknown_tokens:
                    unknown_tokens.add(token_id)
                    print(
                        f"Unknown tokenId, skip for now: {token_id[:30]}... "
                        f"(will rely on next market -> oracle -> trade sync cycle)",
                        file=sys.stderr,
                    )

                if test_mode:
                    row = {
                        "tx_hash": decoded.get("txHash"),
                        "block_number": decoded.get("block_number"),
                        "timestamp": decoded.get("timestamp"),
                        "maker": decoded.get("maker"),
                        "taker": decoded.get("taker"),
                        "price": decoded.get("price"),
                        "size": decoded.get("size"),
                        "side": decoded.get("side"),
                        "token_id": token_id,
                        "market_id": market["id"] if market else None,
                        "market_slug": market.get("slug") if market else None,
                        "outcome": ("YES" if str(market["yes_token_id"]) == token_id else "NO") if market else None,
                        "order_hash": decoded.get("orderHash"),
                        "maker_asset_id": decoded.get("makerAssetId"),
                        "taker_asset_id": decoded.get("takerAssetId"),
                        "maker_amount": decoded.get("makerAmountFilled"),
                        "taker_amount": decoded.get("takerAmountFilled"),
                        "fee": decoded.get("fee"),
                        "contract": decoded.get("contract") or decoded.get("exchange"),
                    }
                    trades_out.append(row)
                    if market:
                        inserted += 1
                elif market:
                    outcome = "YES" if str(market["yes_token_id"]) == token_id else "NO"
                    pending_trade_rows.append(build_trade_insert_row(decoded, market["id"], outcome))
                    if len(pending_trade_rows) >= TRADE_INSERT_BATCH_SIZE:
                        inserted += insert_trades_batch(conn, pending_trade_rows)
                        pending_trade_rows.clear()

                if idx % max(1, len(logs) // 20) == 0 or idx == len(logs):
                    if pending_trade_rows and not test_mode:
                        inserted += insert_trades_batch(conn, pending_trade_rows)
                        pending_trade_rows.clear()
                    progress = (idx / len(logs)) * 100 if logs else 100.0
                    print(
                        f"  ---> 窗口处理进度: {idx}/{len(logs)} ({progress:.1f}%) | inserted={inserted} | unknown_tokens={len(unknown_tokens)}",
                        file=sys.stderr,
                    )

            if pending_trade_rows and not test_mode:
                inserted += insert_trades_batch(conn, pending_trade_rows)
                pending_trade_rows.clear()

            completed_blocks += window_end - window_start + 1
            overall_progress = (completed_blocks / total_blocks) * 100 if total_blocks else 100.0
            if not test_mode and update_sync_state_on_commit:
                update_sync_state(conn, window_end, sync_state_key=sync_state_key)
                conn.commit()
            elif not test_mode:
                conn.commit()

            print(
                f"Window {window_index} done: blocks {window_start}-{window_end} | logs={len(logs)} | processed={processed} | inserted={inserted} | overall_blocks={overall_progress:.1f}%",
                file=sys.stderr,
                flush=True,
            )

        if test_mode:
            payload = {
                "block_range": [from_block, to_block],
                "summary": {"processed": processed, "trades_with_market": inserted},
                "trades": trades_out,
            }
            with open(output_json, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            print(f"Test mode: wrote {len(trades_out)} trades to {output_json}", file=sys.stderr)
    finally:
        conn.close()

    return processed, inserted


def get_last_synced_block(
    db_path: str = DEFAULT_DB_PATH,
    sync_state_key: str = SYNC_STATE_KEY,
) -> Optional[int]:
    """获取上次同步到的区块高度"""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT last_block FROM sync_state WHERE key = ?",
        (sync_state_key,),
    )
    row = cursor.fetchone()
    conn.close()
    return int(row[0]) if row and row[0] is not None else None


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Polymarket Trades Indexer")
    parser.add_argument("--from-block", type=int, help="起始区块")
    parser.add_argument("--to-block", type=int, help="结束区块")
    parser.add_argument("--rpc", default=None, help="RPC URL（默认从 NODE_URL/POLYMARKET_RPC_URL 或 config 读取）")
    add_db_cli_args(parser)
    parser.add_argument("--continue-sync", action="store_true", help="从上次进度继续")
    parser.add_argument("--batch", type=int, default=BATCH_BLOCKS, help="每批区块数")
    parser.add_argument("--max-workers", type=int, default=MAX_WORKERS, help="并发线程数")
    parser.add_argument("--sync-state-key", default=SYNC_STATE_KEY, help="sync_state 中用于读写进度的 key")
    parser.add_argument("--no-sync-state-update", action="store_true", help="写入 trades 但不更新 sync_state，用于历史补齐任务")
    parser.add_argument("--disable-market-backfill", action="store_true", help="仅使用现有 markets 映射，不在交易索引过程中动态回填缺失 market")
    parser.add_argument(
        "--test",
        metavar="JSON_FILE",
        nargs="?",
        const="trades_test.json",
        default=None,
        help="测试模式：不写数据库，将解码后的交易输出到 JSON 文件（默认 trades_test.json）",
    )

    args = parser.parse_args()
    configure_db_from_args(args)
    db_path = args.sqlite_path
    rpc_url = args.rpc or get_rpc_url()
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if geth_poa_middleware is not None:
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)  # Polygon 为 POA 链
    if not w3.is_connected():
        print("Error: Cannot connect to RPC", file=sys.stderr)
        sys.exit(1)
    
    to_block = args.to_block
    if to_block is None:
        to_block = w3.eth.block_number
    
    from_block = args.from_block
    if args.continue_sync:
        last = get_last_synced_block(db_path, sync_state_key=args.sync_state_key)
        from_block = (last + 1) if last is not None else 0
    if from_block is None:
        from_block = max(0, to_block - args.batch)
    
    rpc = rpc_url
    out_json = args.test
    if out_json:
        print(f"Test mode: blocks {from_block} to {to_block} -> {out_json}", file=sys.stderr)
    else:
        print(f"Indexing blocks {from_block} to {to_block} (RPC: {rpc[:50]}...)...", file=sys.stderr)
        print(f"Database target: {describe_db_target()}", file=sys.stderr)
    processed, inserted = run_indexer(
        from_block, to_block, rpc, db_path,
        output_json=out_json,
        batch_blocks=args.batch,
        max_workers=args.max_workers,
        sync_state_key=args.sync_state_key,
        update_sync_state_on_commit=not args.no_sync_state_update,
        enable_market_backfill=not args.disable_market_backfill,
    )
    if out_json:
        print(f"Processed {processed} logs, wrote {inserted} trades to {out_json}.", file=sys.stderr)
    else:
        print(f"Processed {processed} logs, inserted {inserted} trades.", file=sys.stderr)


if __name__ == "__main__":
    main()
