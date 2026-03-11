#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一调度 market / oracle / trade 三条同步链。

设计目标：
1. 严格串行写入同一个 SQLite，避免并发写冲突。
2. 先刷新 market，再回看最近一段 oracle / trade 区块，降低“market 晚到”导致的未匹配问题。
3. 三条链使用同一个安全截止块 high-water mark，保证时间水位尽量一致。
"""

import argparse
import fcntl
import hashlib
import sys
import time
import traceback
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

from config import get_rpc_url
from db import add_db_cli_args, configure_db_from_args, describe_db_target
from market.market_discovery import resolve_incremental_since_date, run_market_discovery
from oracle.fetch_uma_oracle_chain import get_last_oracle_synced_block, run as run_oracle
from trade.trades_indexer import get_last_synced_block as get_last_trade_synced_block, run_indexer

MARKET_SYNC_STATE_KEY = "market_sync"
LIVE_MARKET_SYNC_STATE_KEY = "market_sync_live"
LIVE_ORACLE_SYNC_STATE_KEY = "oracle_sync_live"
LIVE_TRADE_SYNC_STATE_KEY = "trade_sync_live"
RPC_CONNECT_RETRIES = 3
RPC_CONNECT_RETRY_DELAY_SECONDS = 10
WATCH_ERROR_BACKOFF_BASE_SECONDS = 30
WATCH_ERROR_BACKOFF_MAX_SECONDS = 300

try:
    from web3 import Web3
except ImportError:
    print("Error: web3 not installed. pip install web3", file=sys.stderr)
    sys.exit(1)

try:
    from web3.middleware import ExtraDataToPOAMiddleware
except ImportError:
    try:
        from web3.middleware import geth_poa_middleware as ExtraDataToPOAMiddleware
    except ImportError:
        ExtraDataToPOAMiddleware = None


@contextmanager
def _file_lock(lock_path: Path):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w", encoding="utf-8") as f:
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(f"Another sync process is already running: {lock_path}")
        f.write(str(Path.cwd()))
        f.flush()
        try:
            yield
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def _connect_w3(rpc_url: str) -> Web3:
    last_error: Optional[Exception] = None
    for attempt in range(1, RPC_CONNECT_RETRIES + 1):
        try:
            w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
            if ExtraDataToPOAMiddleware:
                w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
            if not w3.is_connected():
                raise ConnectionError(f"Cannot connect to RPC: {rpc_url}")
            return w3
        except Exception as exc:
            last_error = exc
            if attempt >= RPC_CONNECT_RETRIES:
                break
            print(
                f"[sync] RPC connect failed ({attempt}/{RPC_CONNECT_RETRIES}): {exc}. "
                f"Retrying in {RPC_CONNECT_RETRY_DELAY_SECONDS}s...",
                file=sys.stderr,
            )
            time.sleep(RPC_CONNECT_RETRY_DELAY_SECONDS)
    if last_error is None:
        raise ConnectionError(f"Cannot connect to RPC: {rpc_url}")
    raise ConnectionError(f"Cannot connect to RPC: {rpc_url}") from last_error


def _compute_watch_error_backoff(interval_seconds: int, consecutive_failures: int) -> int:
    base = max(WATCH_ERROR_BACKOFF_BASE_SECONDS, int(interval_seconds))
    backoff = base * (2 ** max(0, consecutive_failures - 1))
    return min(backoff, WATCH_ERROR_BACKOFF_MAX_SECONDS)


def _compute_safe_end_block(w3: Web3, confirmations: int) -> int:
    latest = w3.eth.block_number
    return max(0, latest - max(0, confirmations))


def _compute_from_block(
    last_synced: Optional[int],
    safe_end_block: int,
    overlap_blocks: int,
    bootstrap_lookback_blocks: int,
) -> Optional[int]:
    if last_synced is None:
        return max(0, safe_end_block - bootstrap_lookback_blocks)
    if safe_end_block <= last_synced:
        return None
    return max(0, last_synced + 1 - overlap_blocks)


def _compute_tail_from_block(
    last_synced: Optional[int],
    safe_end_block: int,
    lookback_blocks: int,
    overlap_blocks: int,
) -> Optional[int]:
    if last_synced is None:
        return max(0, safe_end_block - lookback_blocks)
    if safe_end_block <= last_synced:
        return None
    return max(0, last_synced + 1 - overlap_blocks)


def _compute_market_since(
    db_path: str,
    sync_state_key: str,
    bootstrap_lookback: timedelta,
    overlap_lookback: timedelta,
    fallback_sync_state_keys: Optional[list[str]] = None,
) -> tuple[datetime, bool]:
    last_synced_at = resolve_incremental_since_date(
        db_path,
        sync_state_key=sync_state_key,
        fallback_sync_state_keys=fallback_sync_state_keys,
    )
    if last_synced_at is None:
        return datetime.now(timezone.utc) - bootstrap_lookback, False
    return last_synced_at - overlap_lookback, True


def run_once(args) -> None:
    rpc_url = args.rpc or get_rpc_url()
    db_path = args.sqlite_path
    w3 = _connect_w3(rpc_url)
    safe_end_block = _compute_safe_end_block(w3, args.confirmations)
    market_since, has_market_checkpoint = _compute_market_since(
        db_path,
        sync_state_key=MARKET_SYNC_STATE_KEY,
        bootstrap_lookback=timedelta(days=args.market_lookback_days),
        overlap_lookback=timedelta(minutes=args.market_overlap_minutes),
    )

    print(
        f"[sync] High-water mark block={safe_end_block} "
        f"(confirmations={args.confirmations})",
        file=sys.stderr,
    )
    if has_market_checkpoint:
        print(
            f"[sync] Step 1/3 market refresh since {market_since.isoformat()} "
            f"(key={MARKET_SYNC_STATE_KEY}, overlap_minutes={args.market_overlap_minutes})",
            file=sys.stderr,
        )
    else:
        print(
            f"[sync] Step 1/3 market refresh since {market_since.date()} "
            f"(bootstrap_lookback_days={args.market_lookback_days})",
            file=sys.stderr,
        )
    market_count = run_market_discovery(
        db_path=db_path,
        since_date=market_since,
        batch_size=args.market_batch_size,
        requests_delay=args.market_delay,
        sync_state_key=MARKET_SYNC_STATE_KEY,
    )
    print(f"[sync] Market refresh done. Stored/updated={market_count}", file=sys.stderr)

    oracle_last = get_last_oracle_synced_block(db_path)
    oracle_from = _compute_from_block(
        oracle_last,
        safe_end_block,
        args.oracle_overlap_blocks,
        args.oracle_bootstrap_lookback_blocks,
    )
    if oracle_from is None:
        print(
            f"[sync] Step 2/3 oracle skipped. safe_end_block={safe_end_block} <= last_oracle_block={oracle_last}",
            file=sys.stderr,
        )
    else:
        adapter_from = max(0, oracle_from - args.adapter_lookback_blocks)
        print(
            f"[sync] Step 2/3 oracle sync blocks {oracle_from}-{safe_end_block} "
            f"(overlap={args.oracle_overlap_blocks}, adapter_lookback={args.adapter_lookback_blocks})",
            file=sys.stderr,
        )
        run_oracle(
            rpc_url=rpc_url,
            db_path=db_path,
            oracle_start_block=oracle_from,
            adapter_start_block=adapter_from,
            end_block=safe_end_block,
            adapter_addresses_raw=args.adapter_addresses,
            oracle_addresses_raw=args.oracle_addresses,
            batch_adapter=args.batch_adapter,
            batch_oracle=args.batch_oracle,
            max_workers=args.max_workers,
        )

    trade_last = get_last_trade_synced_block(db_path)
    trade_from = _compute_from_block(
        trade_last,
        safe_end_block,
        args.trade_overlap_blocks,
        args.trade_bootstrap_lookback_blocks,
    )
    if trade_from is None:
        print(
            f"[sync] Step 3/3 trades skipped. safe_end_block={safe_end_block} <= last_trade_block={trade_last}",
            file=sys.stderr,
        )
    else:
        print(
            f"[sync] Step 3/3 trade sync blocks {trade_from}-{safe_end_block} "
            f"(overlap={args.trade_overlap_blocks})",
            file=sys.stderr,
        )
        processed, inserted = run_indexer(
            trade_from,
            safe_end_block,
            rpc_url=rpc_url,
            db_path=db_path,
            batch_blocks=args.trade_batch_blocks,
        )
        print(
            f"[sync] Trade sync done. processed={processed}, inserted={inserted}",
            file=sys.stderr,
        )


def run_tail_live_once(args) -> None:
    rpc_url = args.rpc or get_rpc_url()
    db_path = args.sqlite_path
    w3 = _connect_w3(rpc_url)
    safe_end_block = _compute_safe_end_block(w3, args.confirmations)
    market_since, has_market_checkpoint = _compute_market_since(
        db_path,
        sync_state_key=LIVE_MARKET_SYNC_STATE_KEY,
        bootstrap_lookback=timedelta(minutes=args.tail_market_lookback_minutes),
        overlap_lookback=timedelta(minutes=args.market_overlap_minutes),
        fallback_sync_state_keys=[MARKET_SYNC_STATE_KEY],
    )

    print(
        f"[tail-live] High-water mark block={safe_end_block} "
        f"(confirmations={args.confirmations})",
        file=sys.stderr,
    )
    if has_market_checkpoint:
        print(
            f"[tail-live] Step 1/3 market refresh since {market_since.isoformat()} "
            f"(live_key={LIVE_MARKET_SYNC_STATE_KEY}, overlap_minutes={args.market_overlap_minutes})",
            file=sys.stderr,
        )
    else:
        print(
            f"[tail-live] Step 1/3 market refresh since {market_since.isoformat()} "
            f"(bootstrap_lookback_minutes={args.tail_market_lookback_minutes}, live_key={LIVE_MARKET_SYNC_STATE_KEY})",
            file=sys.stderr,
        )
    market_count = run_market_discovery(
        db_path=db_path,
        since_date=market_since,
        batch_size=args.market_batch_size,
        requests_delay=args.market_delay,
        sync_state_key=LIVE_MARKET_SYNC_STATE_KEY,
    )
    print(f"[tail-live] Market refresh done. Stored/updated={market_count}", file=sys.stderr)

    oracle_last = get_last_oracle_synced_block(db_path, sync_state_key=LIVE_ORACLE_SYNC_STATE_KEY)
    oracle_from = _compute_tail_from_block(
        oracle_last,
        safe_end_block,
        args.tail_oracle_lookback_blocks,
        args.oracle_overlap_blocks,
    )
    if oracle_from is None:
        print(
            f"[tail-live] Step 2/3 oracle skipped. safe_end_block={safe_end_block} <= last_live_oracle_block={oracle_last}",
            file=sys.stderr,
        )
    else:
        adapter_from = max(0, oracle_from - args.adapter_lookback_blocks)
        print(
            f"[tail-live] Step 2/3 oracle sync blocks {oracle_from}-{safe_end_block} "
            f"(live_key={LIVE_ORACLE_SYNC_STATE_KEY}, overlap={args.oracle_overlap_blocks})",
            file=sys.stderr,
        )
        run_oracle(
            rpc_url=rpc_url,
            db_path=db_path,
            oracle_start_block=oracle_from,
            adapter_start_block=adapter_from,
            end_block=safe_end_block,
            adapter_addresses_raw=args.adapter_addresses,
            oracle_addresses_raw=args.oracle_addresses,
            batch_adapter=args.batch_adapter,
            batch_oracle=args.batch_oracle,
            max_workers=args.max_workers,
            sync_state_key=LIVE_ORACLE_SYNC_STATE_KEY,
        )

    if not args.tail_include_trade:
        print(
            "[tail-live] Step 3/3 trades skipped. Live trade tail is disabled to avoid conflicting with historical trade backfill.",
            file=sys.stderr,
        )
        return

    trade_last = get_last_trade_synced_block(db_path, sync_state_key=LIVE_TRADE_SYNC_STATE_KEY)
    trade_from = _compute_tail_from_block(
        trade_last,
        safe_end_block,
        args.tail_trade_lookback_blocks,
        args.trade_overlap_blocks,
    )
    if trade_from is None:
        print(
            f"[tail-live] Step 3/3 trades skipped. safe_end_block={safe_end_block} <= last_live_trade_block={trade_last}",
            file=sys.stderr,
        )
        return

    print(
        f"[tail-live] Step 3/3 trade sync blocks {trade_from}-{safe_end_block} "
        f"(live_key={LIVE_TRADE_SYNC_STATE_KEY}, overlap={args.trade_overlap_blocks})",
        file=sys.stderr,
    )
    processed, inserted = run_indexer(
        trade_from,
        safe_end_block,
        rpc_url=rpc_url,
        db_path=db_path,
        batch_blocks=args.trade_batch_blocks,
        sync_state_key=LIVE_TRADE_SYNC_STATE_KEY,
    )
    print(
        f"[tail-live] Trade sync done. processed={processed}, inserted={inserted}",
        file=sys.stderr,
    )


def main():
    parser = argparse.ArgumentParser(
        description="统一调度 market -> oracle -> trade，同库串行写入并保持时间水位对齐"
    )
    add_db_cli_args(parser)
    parser.add_argument("--rpc", default=None, help="RPC URL")
    parser.add_argument("--watch", action="store_true", help="循环运行")
    parser.add_argument("--tail-live", action="store_true", help="实时尾流模式：优先追最新 market/oracle，可选开启 trade live tail")
    parser.add_argument("--tail-include-trade", action="store_true", help="在 --tail-live 模式下同时追最新 trade；默认关闭，避免与历史 trade backfill 冲突")
    parser.add_argument("--interval", type=int, default=300, help="watch 模式下每轮间隔秒数")
    parser.add_argument("--confirmations", type=int, default=20, help="安全截止块确认数")
    parser.add_argument("--market-lookback-days", type=int, default=2, help="每轮市场回看天数")
    parser.add_argument("--tail-market-lookback-minutes", type=int, default=60, help="--tail-live 模式下 market 每轮回看分钟数")
    parser.add_argument("--market-overlap-minutes", type=int, default=5, help="market 增量同步的额外回看分钟数，避免边界遗漏")
    parser.add_argument("--market-batch-size", type=int, default=500, help="市场批量写入大小")
    parser.add_argument("--market-delay", type=float, default=0.0, help="市场 API 请求间隔秒数")
    parser.add_argument("--oracle-overlap-blocks", type=int, default=20000, help="oracle 每轮回看区块数")
    parser.add_argument("--tail-oracle-lookback-blocks", type=int, default=5000, help="--tail-live 模式下 oracle 首次启动默认回看区块数")
    parser.add_argument("--adapter-lookback-blocks", type=int, default=200000, help="oracle 同步时额外回看 adapter 区块数")
    parser.add_argument("--oracle-bootstrap-lookback-blocks", type=int, default=500000, help="oracle 无断点时默认回看区块数")
    parser.add_argument("--trade-overlap-blocks", type=int, default=10000, help="trade 每轮回看区块数")
    parser.add_argument("--tail-trade-lookback-blocks", type=int, default=5000, help="--tail-live 模式下 trade 首次启动默认回看区块数")
    parser.add_argument("--trade-bootstrap-lookback-blocks", type=int, default=100000, help="trade 无断点时默认回看区块数")
    parser.add_argument("--trade-batch-blocks", type=int, default=5000, help="trade 每批区块数")
    parser.add_argument("--batch-adapter", type=int, default=2000, help="oracle adapter 每批区块数")
    parser.add_argument("--batch-oracle", type=int, default=2000, help="oracle 事件每批区块数")
    parser.add_argument("--max-workers", type=int, default=30, help="oracle 并发线程数")
    parser.add_argument("--adapter-addresses", default=None, help="可选覆盖默认 adapter 地址列表，逗号分隔")
    parser.add_argument("--oracle-addresses", default=None, help="可选覆盖默认 oracle 地址列表，逗号分隔")
    args = parser.parse_args()
    configure_db_from_args(args)

    lock_key = hashlib.sha1(describe_db_target().encode("utf-8")).hexdigest()[:12]
    lock_path = Path("/tmp") / f"polydata-unified-sync-{lock_key}.lock"
    with _file_lock(lock_path):
        print(f"[sync] Database target: {describe_db_target()}", file=sys.stderr)
        if args.watch:
            run_index = 0
            consecutive_failures = 0
            try:
                while True:
                    run_index += 1
                    print(
                        f"\n[sync] Run #{run_index} at {datetime.now(timezone.utc).isoformat()}",
                        file=sys.stderr,
                    )
                    try:
                        if args.tail_live:
                            run_tail_live_once(args)
                        else:
                            run_once(args)
                        consecutive_failures = 0
                        print(f"[sync] Sleeping {args.interval}s", file=sys.stderr)
                        time.sleep(args.interval)
                    except KeyboardInterrupt:
                        raise
                    except Exception as exc:
                        consecutive_failures += 1
                        backoff_seconds = _compute_watch_error_backoff(args.interval, consecutive_failures)
                        print(
                            f"[sync] Run #{run_index} failed: {exc}",
                            file=sys.stderr,
                        )
                        traceback.print_exc(file=sys.stderr)
                        print(
                            f"[sync] Entering recovery sleep for {backoff_seconds}s "
                            f"(consecutive_failures={consecutive_failures}) before retrying.",
                            file=sys.stderr,
                        )
                        time.sleep(backoff_seconds)
            except KeyboardInterrupt:
                print("\n[sync] Interrupted by user. Exiting.", file=sys.stderr)
        else:
            if args.tail_live:
                run_tail_live_once(args)
            else:
                run_once(args)


if __name__ == "__main__":
    main()
