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

from db import get_connection, get_db, init_schema, dict_from_row, DEFAULT_DB_PATH
from trade.trade_decoder import decode_order_filled_log, CTF_EXCHANGE_ADDRESS, NEG_RISK_EXCHANGE_ADDRESS
from market.market_discovery import run_market_discovery, normalize_market_from_gamma
from config import get_rpc_url
import requests

USDC_DIVISOR = 10**6
SYNC_STATE_KEY = "trade_sync"
BATCH_BLOCKS = 5000
MAX_RETRIES = 5
RETRY_DELAY_BASE = 2


def get_order_filled_topic(w3: Web3) -> bytes:
    sig = "OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)"
    return w3.keccak(text=sig)


def fetch_logs_with_retry(
    w3: Web3,
    from_block: int,
    to_block: int,
) -> List[Dict]:
    """带指数退避的 getLogs"""
    addresses = [
        Web3.to_checksum_address(CTF_EXCHANGE_ADDRESS),
        Web3.to_checksum_address(NEG_RISK_EXCHANGE_ADDRESS),
    ]
    topic = get_order_filled_topic(w3)
    
    for attempt in range(MAX_RETRIES):
        try:
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
            delay = RETRY_DELAY_BASE ** (attempt + 1)
            print(f"getLogs failed (attempt {attempt+1}/{MAX_RETRIES}): {e}, retry in {delay}s", file=sys.stderr)
            time.sleep(delay)
    return []


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


def find_market_by_token_id(conn, token_id: str) -> Optional[Dict]:
    """根据 tokenId 查找市场"""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM markets WHERE yes_token_id = ? OR no_token_id = ? LIMIT 1",
        (str(token_id), str(token_id)),
    )
    row = cursor.fetchone()
    return dict_from_row(row) if row else None


def try_discover_market_from_gamma(token_id: str, db_path: str) -> bool:
    """
    尝试从 Gamma API 动态发现包含该 tokenId 的市场
    通过拉取市场列表并匹配 clobTokenIds
    """
    url = "https://gamma-api.polymarket.com/markets"
    for offset in range(0, 500, 100):
        try:
            resp = requests.get(url, params={"limit": 100, "offset": offset}, timeout=30)
            resp.raise_for_status()
            markets = resp.json()
        except Exception:
            return False
        if not isinstance(markets, list):
            break
        for m in markets:
            norm = normalize_market_from_gamma(m)
            if not norm:
                continue
            if str(norm["yes_token_id"]) == str(token_id) or str(norm["no_token_id"]) == str(token_id):
                init_schema(db_path=db_path)
                with get_db(db_path) as c:
                    from market.market_discovery import upsert_market
                    upsert_market(c, norm)
                return True
        if len(markets) < 100:
            break
    return False


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


def insert_trade(conn, trade: Dict, market_id: int, outcome: str) -> bool:
    """插入交易记录，唯一键冲突时忽略（幂等）"""
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT OR IGNORE INTO trades (
                tx_hash, log_index, market_id, maker, taker, price, size,
                side, outcome, token_id, block_number, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
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
            ),
        )
        return cursor.rowcount > 0
    except Exception as e:
        print(f"Insert trade error: {e}", file=sys.stderr)
        return False


def run_indexer(
    from_block: int,
    to_block: int,
    rpc_url: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH,
    output_json: Optional[str] = None,
    batch_blocks: int = BATCH_BLOCKS,
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

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if geth_poa_middleware is not None:
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)  # Polygon 为 POA 链，需注入以正确解析区块
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to RPC: {rpc_url}")

    conn = get_connection(db_path)
    block_ts_cache: Dict[int, str] = {}
    inserted = 0
    processed = 0
    unknown_tokens = set()
    trades_out: List[Dict] = []  # 测试模式收集

    current = from_block
    while current <= to_block:
        batch_end = min(current + batch_blocks - 1, to_block)
        print(f"Fetching logs blocks {current}-{batch_end}...", file=sys.stderr, flush=True)
        logs = fetch_logs_with_retry(w3, current, batch_end)

        for log in logs:
            processed += 1
            decoded = decode_and_enrich(log, w3, block_ts_cache)
            if not decoded:
                continue

            token_id = str(decoded["tokenId"])
            market = find_market_by_token_id(conn, token_id)

            if not market and token_id not in unknown_tokens:
                try_discover_market_from_gamma(token_id, db_path)
                conn = get_connection(db_path)
                market = find_market_by_token_id(conn, token_id)
                if not market:
                    unknown_tokens.add(token_id)
                    print(f"Unknown tokenId, skip: {token_id[:30]}...", file=sys.stderr)

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
                }
                trades_out.append(row)
                if market:
                    inserted += 1
            elif market:
                outcome = "YES" if str(market["yes_token_id"]) == token_id else "NO"
                if insert_trade(conn, decoded, market["id"], outcome):
                    inserted += 1

        if not test_mode:
            conn.commit()
        current = batch_end + 1

    if test_mode:
        payload = {
            "block_range": [from_block, to_block],
            "summary": {"processed": processed, "trades_with_market": inserted},
            "trades": trades_out,
        }
        with open(output_json, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Test mode: wrote {len(trades_out)} trades to {output_json}", file=sys.stderr)
    else:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO sync_state (key, value, last_block, updated_at) VALUES (?, ?, ?, ?)",
            (SYNC_STATE_KEY, str(to_block), to_block, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")),
        )
        conn.commit()
        conn.close()

    return processed, inserted


def get_last_synced_block(db_path: str = DEFAULT_DB_PATH) -> Optional[int]:
    """获取上次同步到的区块高度"""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT last_block FROM sync_state WHERE key = ?",
        (SYNC_STATE_KEY,),
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
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="数据库路径")
    parser.add_argument("--continue-sync", action="store_true", help="从上次进度继续")
    parser.add_argument("--batch", type=int, default=BATCH_BLOCKS, help="每批区块数")
    parser.add_argument(
        "--test",
        metavar="JSON_FILE",
        nargs="?",
        const="trades_test.json",
        default=None,
        help="测试模式：不写数据库，将解码后的交易输出到 JSON 文件（默认 trades_test.json）",
    )

    args = parser.parse_args()
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
        last = get_last_synced_block(args.db)
        from_block = (last + 1) if last is not None else 0
    if from_block is None:
        from_block = max(0, to_block - args.batch)
    
    rpc = rpc_url
    out_json = args.test
    if out_json:
        print(f"Test mode: blocks {from_block} to {to_block} -> {out_json}", file=sys.stderr)
    else:
        print(f"Indexing blocks {from_block} to {to_block} (RPC: {rpc[:50]}...)...", file=sys.stderr)
    processed, inserted = run_indexer(
        from_block, to_block, rpc, args.db,
        output_json=out_json,
        batch_blocks=args.batch,
    )
    if out_json:
        print(f"Processed {processed} logs, wrote {inserted} trades to {out_json}.", file=sys.stderr)
    else:
        print(f"Processed {processed} logs, inserted {inserted} trades.", file=sys.stderr)


if __name__ == "__main__":
    main()
