#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UMA Oracle 链上数据拉取（多 adapter + 多 oracle 版本并集）

通过 RPC (web3.py) 获取链上数据，解决 ancillaryData 与 Polymarket question_id 脱节问题：
1. 并集抓取多个 UmaCtfAdapter 的 QuestionInitialized
2. 并集抓取多个 UMA Oracle 地址上的 RequestPrice/ProposePrice/DisputePrice/Settle
3. 用 ancillaryData 构建本地 question_id 映射
4. 用数据库桥接到市场
5. 输出为 parquet/json
"""

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone

_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

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

from config import get_rpc_url
from db import (
    add_db_cli_args,
    configure_db_from_args,
    DEFAULT_DB_PATH,
    create_index_if_not_exists,
    describe_db_target,
    get_connection,
    get_table_columns,
    init_schema,
)

# 合约地址（Polygon）
DEFAULT_ORACLE_ADDRESSES = [
    "0xeE3Afe347D5C74317041E2618C49534dAf887c24",  # OptimisticOracleV2
    "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130",  # 历史/文档中出现的另一条 UMA 路径
]
DEFAULT_ADAPTER_ADDRESSES = [
    "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d",  # UmaCtf Adapter V3
    "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",  # UmaCtf Adapter V2
    "0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49",  # 文档中的 UmaCtfAdapter v3.0
]
UMA_ORACLE_ADDRESS = DEFAULT_ORACLE_ADDRESSES[0]
UMA_ADAPTER_ADDRESS = DEFAULT_ADAPTER_ADDRESSES[0]

EVENT_SIGNATURES = {
    "request": "RequestPrice(address,bytes32,uint256,bytes,address,uint256,uint256)",
    "propose": "ProposePrice(address,address,bytes32,uint256,bytes,int256,uint256,address)",
    "dispute": "DisputePrice(address,address,address,bytes32,uint256,bytes,int256)",
    "settle": "Settle(address,address,address,bytes32,uint256,bytes,int256,uint256)",
    "question_initialized": "QuestionInitialized(bytes32,uint256,address,bytes,address,uint256,uint256)",
}

# Growth 套餐 250 RPS，步长 2000 + 多线程可大幅提速
BATCH_BLOCKS_ORACLE = 2000
BATCH_BLOCKS_ADAPTER = 2000
MAX_RETRIES = 5
RETRY_DELAY_BASE = 2
MAX_LOGS: Optional[int] = None
PARQUET_WRITE_BATCH = 5000
ORACLE_SYNC_STATE_KEY = "oracle_sync"

POLYMARKET_DB = os.environ.get("POLYMARKET_DB", DEFAULT_DB_PATH)


def _topic0(sig: str) -> str:
    return "0x" + Web3.keccak(text=sig).hex()


def _ancillary_to_utf8(data: bytes) -> str:
    """将 ancillaryData 完整解码为 utf-8，不截断"""
    if not data:
        return ""
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _ancillary_to_hex(data: bytes) -> str:
    """bytes -> 0x 开头的 hex 字符串，用于 SQLite 存储/查询"""
    if not data:
        return "0x"
    h = data.hex()
    return "0x" + h if not h.startswith("0x") else h


def _normalize_address(value: Any) -> str:
    if not value:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    if not s.startswith("0x"):
        s = "0x" + s
    try:
        return Web3.to_checksum_address(s)
    except Exception:
        return s.lower()


def _parse_address_list(raw: Optional[str], defaults: List[str]) -> List[str]:
    if not raw:
        return [_normalize_address(x) for x in defaults]
    parts = [p.strip() for p in raw.split(",")]
    out: List[str] = []
    for p in parts:
        if not p:
            continue
        addr = _normalize_address(p)
        if addr and addr not in out:
            out.append(addr)
    return out


def _hex_to_bytes(s: str) -> bytes:
    if not s or s == "0x":
        return b""
    s = s.strip()
    if not s.startswith("0x"):
        s = "0x" + s
    try:
        return bytes.fromhex(s[2:])
    except Exception:
        return b""


def _parse_question_raw(raw: str) -> Tuple[str, str, str]:
    """从 question_raw_text 提取 description, p1, p2"""
    desc, p1_val, p2_val = "", "", ""
    if not raw:
        return desc, p1_val, p2_val
    try:
        m = re.search(r"(?s)description:\s*(.*?)(?:\s*market_id:|$)", raw)
        if m:
            desc = m.group(1).strip()
        m1 = re.search(r"p1:\s*([0-9]+)", raw)
        if m1:
            p1_val = m1.group(1)
        m2 = re.search(r"p2:\s*([0-9]+)", raw)
        if m2:
            p2_val = m2.group(1)
    except Exception:
        pass
    return desc, p1_val, p2_val


def _normalize_title(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _extract_market_id(raw: str) -> str:
    if not isinstance(raw, str):
        return ""
    m = re.search(r"market_id:\s*([0-9]+)", raw, re.IGNORECASE)
    return m.group(1) if m else ""


def _extract_title(raw: str) -> str:
    if not isinstance(raw, str):
        return ""
    m = re.search(r"title:\s*(.*?)(?:,\s*description:|$)", raw, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def _parse_any_datetime(value: str) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    for fmt in (
        "%Y-%m-%d %H:%M:%S.000 UTC",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            dt = datetime.strptime(value, fmt)
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except ValueError:
            continue
    return None


def _connect_sqlite_readonly(db_path: str):
    return get_connection(db_path, readonly=True)


def _table_has_column(conn, table: str, column: str) -> bool:
    return column in set(get_table_columns(conn, table))


def _get_earliest_market_created_at(db_path: str) -> Optional[str]:
    conn = _connect_sqlite_readonly(db_path)
    try:
        cur = conn.execute(
            "SELECT MIN(created_at) FROM markets WHERE created_at IS NOT NULL AND TRIM(created_at) != ''"
        )
        row = cur.fetchone()
        return row[0] if row and row[0] else None
    finally:
        conn.close()


def get_last_oracle_synced_block(
    db_path: str,
    sync_state_key: str = ORACLE_SYNC_STATE_KEY,
) -> Optional[int]:
    conn = _connect_sqlite_readonly(db_path)
    try:
        cur = conn.execute(
            "SELECT last_block FROM sync_state WHERE key = ?",
            (sync_state_key,),
        )
        row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except Exception:
        return None
    finally:
        conn.close()


def save_oracle_synced_block(
    db_path: str,
    last_block: int,
    sync_state_key: str = ORACLE_SYNC_STATE_KEY,
) -> None:
    conn = _connect_sqlite_write(db_path)
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO sync_state (key, value, last_block, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                sync_state_key,
                str(last_block),
                int(last_block),
                datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _select_market_by_title(
    candidates: List[Dict[str, Any]], event_time: str
) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    用标题桥接 DB。
    - 只有一个候选时直接采用
    - 重复标题时按 end_date 与 event_time 的接近程度消歧
    """
    if not candidates:
        return None, ""
    if len(candidates) == 1:
        return candidates[0], "by_title"

    event_dt = _parse_any_datetime(event_time)
    if event_dt is None:
        return None, ""

    scored: List[Tuple[float, float, Dict[str, Any]]] = []
    for candidate in candidates:
        end_dt = _parse_any_datetime(candidate.get("end_date", ""))
        created_dt = _parse_any_datetime(candidate.get("created_at", ""))
        end_diff = abs((end_dt - event_dt).total_seconds()) if end_dt else float("inf")
        created_diff = abs((created_dt - event_dt).total_seconds()) if created_dt else float("inf")
        scored.append((end_diff, created_diff, candidate))

    scored.sort(key=lambda item: (item[0], item[1]))
    best_end_diff, _, best_candidate = scored[0]
    # 超过 30 天仍然无法可靠消歧，则放弃自动匹配
    if best_end_diff > 30 * 24 * 3600:
        return None, ""
    return best_candidate, "by_title_nearest_date"


def _load_market_bridge_indices(db_path: str) -> Dict[str, Any]:
    """
    从 markets 表构建 Oracle -> DB 的桥接索引。
    优先使用标题 + 日期消歧，最后再尝试 question_id。
    """
    conn = _connect_sqlite_readonly(db_path)
    try:
        has_gamma_market_id = _table_has_column(conn, "markets", "gamma_market_id")
        cur = conn.execute(
            f"""
            SELECT
                id AS market_id,
                {"gamma_market_id" if has_gamma_market_id else "'' AS gamma_market_id"},
                slug,
                title,
                question_id,
                condition_id,
                created_at,
                end_date
            FROM markets
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    by_gamma_market_id: Dict[str, Dict[str, Any]] = {}
    by_question_id: Dict[str, Dict[str, Any]] = {}
    by_condition_id: Dict[str, Dict[str, Any]] = {}
    title_buckets: Dict[str, List[Dict[str, Any]]] = {}

    for market_id, gamma_market_id, slug, title, question_id, condition_id, created_at, end_date in rows:
        row = {
            "market_id": market_id,
            "gamma_market_id": str(gamma_market_id or "").strip(),
            "slug": slug or "",
            "title": title or "",
            "question_id": question_id or "",
            "condition_id": condition_id or "",
            "created_at": created_at or "",
            "end_date": end_date or "",
        }
        if row["gamma_market_id"]:
            by_gamma_market_id[row["gamma_market_id"]] = row
        qid = str(question_id or "").strip().lower()
        if qid:
            by_question_id[qid] = row
        cid = str(condition_id or "").strip().lower()
        if cid:
            by_condition_id[cid] = row
        norm_title = _normalize_title(title or "")
        if norm_title:
            title_buckets.setdefault(norm_title, []).append(row)

    return {
        "by_gamma_market_id": by_gamma_market_id,
        "by_question_id": by_question_id,
        "by_condition_id": by_condition_id,
        "by_title_buckets": title_buckets,
    }


def _parse_date_to_timestamp(s: str) -> int:
    s = (s or "").strip()
    if not s:
        raise ValueError("日期不能为空")
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except ValueError:
            continue
    raise ValueError(f"无法解析日期: {s}")


def _block_at_timestamp(w3: Web3, target_ts: int, high: Optional[int] = None) -> int:
    low, result = 0, 0
    if high is None:
        high = w3.eth.block_number
    while low <= high:
        mid = (low + high) // 2
        try:
            blk = w3.eth.get_block(mid)
            ts = blk.get("timestamp") or 0
            if ts <= target_ts:
                result = mid
                low = mid + 1
            else:
                high = mid - 1
        except Exception:
            high = mid - 1
    return result


def get_block_timestamp(w3: Web3, block_number: int, max_retries: int = 3) -> Optional[str]:
    hex_block = hex(block_number)
    for attempt in range(max_retries):
        try:
            block = w3.eth.get_block(block_number)
            if block and block.get("timestamp") is not None:
                return datetime.fromtimestamp(block["timestamp"], tz=timezone.utc).strftime(
                    "%Y-%m-%d %H:%M:%S.000 UTC"
                )
        except Exception:
            try:
                maker = getattr(w3, "provider", None) or getattr(w3, "manager", None)
                if maker and hasattr(maker, "make_request"):
                    raw = maker.make_request("eth_getBlockByNumber", [hex_block, False])
                    if raw and raw.get("result"):
                        ts_hex = raw["result"].get("timestamp")
                        if ts_hex is not None:
                            ts = int(ts_hex, 16) if isinstance(ts_hex, str) else int(ts_hex)
                            return datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
                                "%Y-%m-%d %H:%M:%S.000 UTC"
                            )
            except Exception:
                pass
        if attempt < max_retries - 1:
            time.sleep(RETRY_DELAY_BASE ** (attempt + 1))
    return None


def _block_ts(w3: Web3, block_number: int, cache: Optional[Dict[int, str]] = None) -> str:
    if cache is not None and block_number in cache:
        return cache[block_number] or ""
    ts = get_block_timestamp(w3, block_number)
    if cache is not None:
        cache[block_number] = ts or ""
    return ts or ""


def fetch_logs_with_retry(
    w3: Web3,
    from_block: int,
    to_block: int,
    address: str,
    topics: List[str],
    batch_blocks: int = BATCH_BLOCKS_ORACLE,
    max_logs: Optional[int] = None,
    max_workers: int = 30,
) -> List[Dict]:
    limit = max_logs if max_logs is not None else MAX_LOGS

    # 1. 切分任务区块
    ranges = []
    current = from_block
    while current <= to_block:
        end = min(current + batch_blocks - 1, to_block)
        ranges.append((current, end))
        current = end + 1

    total_tasks = len(ranges)
    print(f"  ... 任务已切分为 {total_tasks} 个并发批次 (每批 {batch_blocks} 块)，启动 {max_workers} 个工作线程...", file=sys.stderr)

    logs: List[Dict] = []
    completed_tasks = 0

    # 2. 单个子任务抓取逻辑
    def _fetch_single_range(start_b: int, end_b: int) -> List[Dict]:
        for attempt in range(MAX_RETRIES):
            try:
                batch = w3.eth.get_logs({
                    "address": Web3.to_checksum_address(address),
                    "fromBlock": start_b,
                    "toBlock": end_b,
                    "topics": [topics],
                })
                return [dict(l) for l in batch]
            except Exception as e:
                delay = RETRY_DELAY_BASE ** (attempt + 1)
                time.sleep(delay)
        print(f"get_logs {start_b}-{end_b} 彻底失败", file=sys.stderr)
        return []

    # 3. 多线程并发
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_range = {executor.submit(_fetch_single_range, r[0], r[1]): r for r in ranges}
        for future in as_completed(future_to_range):
            res = future.result()
            if res:
                logs.extend(res)
            completed_tasks += 1
            if completed_tasks % max(1, total_tasks // 20) == 0 or completed_tasks == total_tasks:
                progress = (completed_tasks / total_tasks) * 100
                print(f"  ---> 抓取进度: {completed_tasks}/{total_tasks} 批次 ({progress:.1f}%) | 累计日志: {len(logs)} 条", file=sys.stderr)

    logs.sort(key=lambda x: (x.get("blockNumber", 0), x.get("logIndex", 0)))
    return logs[:limit] if limit is not None else logs


def fetch_logs_many_addresses(
    w3: Web3,
    from_block: int,
    to_block: int,
    addresses: List[str],
    topics: List[str],
    batch_blocks: int,
    max_logs: Optional[int] = None,
    max_workers: int = 30,
    label: str = "logs",
) -> List[Dict]:
    all_logs: List[Dict] = []
    seen: set[Tuple[str, int, int, str]] = set()
    print(
        f"Fetching {label} from {len(addresses)} address(es): {', '.join(addresses)}",
        file=sys.stderr,
    )
    for idx, address in enumerate(addresses, start=1):
        print(
            f"  [{idx}/{len(addresses)}] address={address} block={from_block}-{to_block}",
            file=sys.stderr,
        )
        logs = fetch_logs_with_retry(
            w3,
            from_block,
            to_block,
            address,
            topics,
            batch_blocks=batch_blocks,
            max_logs=max_logs,
            max_workers=max_workers,
        )
        for log in logs:
            tx_hash = _ensure_0x(log.get("transactionHash") or "")
            block_number = int(log.get("blockNumber", 0) or 0)
            log_index = int(log.get("logIndex", 0) or 0)
            addr = _normalize_address(log.get("address") or address).lower()
            key = (tx_hash.lower(), block_number, log_index, addr)
            if key in seen:
                continue
            seen.add(key)
            log["_source_address"] = addr
            all_logs.append(log)
    all_logs.sort(
        key=lambda x: (
            int(x.get("blockNumber", 0) or 0),
            int(x.get("logIndex", 0) or 0),
            str(x.get("_source_address") or x.get("address") or ""),
        )
    )
    if max_logs is not None:
        return all_logs[:max_logs]
    return all_logs


# ===================== Step 1: 初始化 SQLite 映射表 =====================
def init_uma_adapter_mapping(conn) -> None:
    init_schema(conn=conn)
    conn.commit()


# ===================== Step 2: 增量同步适配器字典 =====================
def _decode_question_initialized(w3: Web3, log: Dict) -> Optional[Tuple[str, str]]:
    """返回 (ancillary_hex, question_id_hex)"""
    abi = {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "questionID", "type": "bytes32"},
            {"indexed": True, "name": "requestTimestamp", "type": "uint256"},
            {"indexed": True, "name": "creator", "type": "address"},
            {"indexed": False, "name": "ancillaryData", "type": "bytes"},
            {"indexed": False, "name": "rewardToken", "type": "address"},
            {"indexed": False, "name": "reward", "type": "uint256"},
            {"indexed": False, "name": "proposalBond", "type": "uint256"},
        ],
        "name": "QuestionInitialized",
        "type": "event",
    }
    try:
        contract = w3.eth.contract(abi=[abi])
        decoded = contract.events.QuestionInitialized().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData") or b""
        qid = args.get("questionID")
        if qid is None:
            return None
        qid_hex = qid.hex() if hasattr(qid, "hex") else str(qid)
        if not qid_hex.startswith("0x"):
            qid_hex = "0x" + qid_hex
        return (_ancillary_to_hex(ad), qid_hex[:66])
    except Exception as e:
        print(f"Decode QuestionInitialized error: {e}", file=sys.stderr)
        return None


def sync_adapter_mapping(
    w3: Web3,
    conn,
    adapter_start_block: int,
    end_block: int,
    batch_blocks: int = BATCH_BLOCKS_ADAPTER,
    max_workers: int = 30,
) -> int:
    """增量同步 QuestionInitialized 到 uma_adapter_mapping，返回插入条数"""
    topic0 = _topic0(EVENT_SIGNATURES["question_initialized"])
    print(f"Sync QuestionInitialized {adapter_start_block}-{end_block} (batch={batch_blocks})...", file=sys.stderr)
    logs = fetch_logs_with_retry(
        w3, adapter_start_block, end_block,
        Web3.to_checksum_address(UMA_ADAPTER_ADDRESS),
        [topic0],
        batch_blocks=batch_blocks,
        max_logs=MAX_LOGS,
        max_workers=max_workers,
    )
    inserted = 0
    for log in logs:
        res = _decode_question_initialized(w3, log)
        if res:
            ancillary_hex, question_id = res
            try:
                cur = conn.execute(
                    "INSERT OR IGNORE INTO uma_adapter_mapping (ancillary_data, question_id) VALUES (?, ?)",
                    (ancillary_hex, question_id),
                )
                if cur.rowcount > 0:
                    inserted += 1
            except Exception as e:
                print(f"INSERT error: {e}", file=sys.stderr)
    conn.commit()
    cur = conn.execute("SELECT COUNT(*) FROM uma_adapter_mapping")
    total = cur.fetchone()[0]
    print(f"  新增 {inserted} 条，映射表共 {total} 条", file=sys.stderr)
    return inserted


def load_adapter_mapping(conn) -> Dict[str, str]:
    """从 SQLite 加载 ancillary_data (hex) -> question_id 映射"""
    cur = conn.execute("SELECT ancillary_data, question_id FROM uma_adapter_mapping")
    return {row[0].lower() if row[0] else "": row[1] or "" for row in cur.fetchall()}


def save_adapter_mapping_entries(conn, mapping: Dict[str, str]) -> int:
    if not mapping:
        return 0
    before = conn.total_changes
    conn.executemany(
        """
        INSERT INTO uma_adapter_mapping (ancillary_data, question_id)
        VALUES (?, ?)
        ON CONFLICT(ancillary_data) DO UPDATE SET
            question_id=excluded.question_id
        """,
        [(k.lower(), v) for k, v in mapping.items() if k and v],
    )
    conn.commit()
    return conn.total_changes - before


def _connect_sqlite_write(db_path: str):
    init_schema(db_path=db_path)
    return get_connection(db_path)


def ensure_oracle_events_table(conn) -> None:
    init_schema(conn=conn)
    create_index_if_not_exists(conn, "oracle_events", "idx_oracle_events_market_id", ["market_id"])
    create_index_if_not_exists(conn, "oracle_events", "idx_oracle_events_question_id", ["question_id"])
    create_index_if_not_exists(conn, "oracle_events", "idx_oracle_events_condition_id", ["condition_id"])
    create_index_if_not_exists(conn, "oracle_events", "idx_oracle_events_block", ["block_number"])
    create_index_if_not_exists(conn, "oracle_events", "idx_oracle_events_status", ["event_status"])
    create_index_if_not_exists(conn, "oracle_events", "idx_oracle_events_matched_by", ["matched_by"])
    conn.commit()


class _OracleDbWriter:
    def __init__(self, db_path: str, batch_size: int = 1000) -> None:
        self.conn = _connect_sqlite_write(db_path)
        ensure_oracle_events_table(self.conn)
        self.batch_size = batch_size
        self.total = 0
        self._buffer: List[Dict[str, Any]] = []

    def write(self, record: Dict[str, Any]) -> None:
        self.total += 1
        self._buffer.append(record)
        if len(self._buffer) >= self.batch_size:
            self.flush()

    def flush(self) -> None:
        if not self._buffer:
            return
        self.conn.executemany(
            """
            INSERT INTO oracle_events (
                tx_hash, log_index, block_number, event_time, event_status,
                external_market_id, market_id, market_title, source_adapter, source_oracle,
                adapter_question_id, matched_by, question_id, condition_id, string_raw,
                p1, p2, proposed_price, settled_price, settlement_recipient, payout,
                requester, proposer, disputer, request_transaction, proposal_transaction,
                settlement_transaction
            ) VALUES (
                :tx_hash, :log_index, :block_number, :event_time, :event_status,
                :external_market_id, :market_id, :market_title, :source_adapter, :source_oracle,
                :adapter_question_id, :matched_by, :question_id, :condition_id, :string_raw,
                :p1, :p2, :proposed_price, :settled_price, :settlement_recipient, :payout,
                :requester, :proposer, :disputer, :request_transaction, :proposal_transaction,
                :settlement_transaction
            )
            ON CONFLICT(tx_hash, log_index) DO UPDATE SET
                block_number=excluded.block_number,
                event_time=excluded.event_time,
                event_status=excluded.event_status,
                external_market_id=excluded.external_market_id,
                market_id=excluded.market_id,
                market_title=excluded.market_title,
                source_adapter=excluded.source_adapter,
                source_oracle=excluded.source_oracle,
                adapter_question_id=excluded.adapter_question_id,
                matched_by=excluded.matched_by,
                question_id=excluded.question_id,
                condition_id=excluded.condition_id,
                string_raw=excluded.string_raw,
                p1=excluded.p1,
                p2=excluded.p2,
                proposed_price=excluded.proposed_price,
                settled_price=excluded.settled_price,
                settlement_recipient=excluded.settlement_recipient,
                payout=excluded.payout,
                requester=excluded.requester,
                proposer=excluded.proposer,
                disputer=excluded.disputer,
                request_transaction=excluded.request_transaction,
                proposal_transaction=excluded.proposal_transaction,
                settlement_transaction=excluded.settlement_transaction
            """,
            self._buffer,
        )
        self.conn.commit()
        self._buffer.clear()

    def close(self) -> None:
        self.flush()
        self.conn.close()


def build_adapter_mapping(
    w3: Web3,
    adapter_start_block: int,
    end_block: int,
    adapter_addresses: List[str],
    batch_blocks: int = BATCH_BLOCKS_ADAPTER,
    max_workers: int = 30,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """仅在内存中构建 ancillary_data (hex) -> question_id 映射，不写数据库。"""
    topic0 = _topic0(EVENT_SIGNATURES["question_initialized"])
    logs = fetch_logs_many_addresses(
        w3,
        adapter_start_block,
        end_block,
        adapter_addresses,
        [topic0],
        batch_blocks=batch_blocks,
        max_logs=MAX_LOGS,
        max_workers=max_workers,
        label="QuestionInitialized",
    )
    mapping: Dict[str, str] = {}
    mapping_source: Dict[str, str] = {}
    conflict_count = 0
    for log in logs:
        res = _decode_question_initialized(w3, log)
        if not res:
            continue
        ancillary_hex, question_id = res
        key = (ancillary_hex or "").lower()
        if key and question_id:
            old_qid = mapping.get(key)
            if old_qid and old_qid != question_id:
                conflict_count += 1
            mapping[key] = question_id
            mapping_source[key] = str(log.get("_source_address") or log.get("address") or "").lower()
    print(
        f"  内存映射条数: {len(mapping)}"
        + (f" | ancillary 冲突覆盖: {conflict_count}" if conflict_count else ""),
        file=sys.stderr,
    )
    return mapping, mapping_source


class _RecordWriter:
    def __init__(self, out: str, parquet_batch_size: int = PARQUET_WRITE_BATCH) -> None:
        self.out_path = Path(out)
        self.out_path.parent.mkdir(parents=True, exist_ok=True)
        self.suffix = self.out_path.suffix.lower()
        self.parquet_batch_size = parquet_batch_size
        self.total = 0
        self._buffer: List[Dict[str, Any]] = []
        self._json_records: List[Dict[str, Any]] = []
        self._parquet_writer = None
        self._pa = None
        self._pq = None

        if self.suffix == ".parquet":
            import pyarrow as pa
            import pyarrow.parquet as pq

            self._pa = pa
            self._pq = pq

    def write(self, record: Dict[str, Any]) -> None:
        self.total += 1
        if self.suffix == ".parquet":
            self._buffer.append(record)
            if len(self._buffer) >= self.parquet_batch_size:
                self._flush_parquet()
            return
        self._json_records.append(record)

    def _flush_parquet(self) -> None:
        if not self._buffer:
            return
        table = self._pa.Table.from_pylist(self._buffer)
        if self._parquet_writer is None:
            self._parquet_writer = self._pq.ParquetWriter(
                self.out_path,
                table.schema,
                compression="snappy",
            )
        self._parquet_writer.write_table(table)
        self._buffer.clear()

    def close(self) -> None:
        if self.suffix == ".parquet":
            self._flush_parquet()
            if self._parquet_writer is not None:
                self._parquet_writer.close()
            return

        with open(self.out_path, "w", encoding="utf-8") as f:
            json.dump(
                {"source": "UMA Optimistic Oracle (chain)", "records": self._json_records},
                f,
                ensure_ascii=False,
                indent=2,
            )


# ===================== Step 3 & 4 & 5: Oracle 抓取 + 字典合并 + 输出 =====================
def decode_request_price(log: Dict, w3: Web3, block_ts_cache: Dict[int, str]) -> Optional[Dict]:
    abi = {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "requester", "type": "address"},
            {"indexed": False, "name": "identifier", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "ancillaryData", "type": "bytes"},
            {"indexed": False, "name": "currency", "type": "address"},
            {"indexed": False, "name": "reward", "type": "uint256"},
            {"indexed": False, "name": "finalFee", "type": "uint256"},
        ],
        "name": "RequestPrice",
        "type": "event",
    }
    try:
        decoded = w3.eth.contract(abi=[abi]).events.RequestPrice().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData") or b""
        raw = _ancillary_to_utf8(ad)
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        return {
            "block_number": log["blockNumber"],
            "log_index": int(log.get("logIndex", 0) or 0),
            "event_time": _block_ts(w3, log["blockNumber"], block_ts_cache),
            "tx_hash": tx,
            "source_oracle": str(log.get("_source_address") or log.get("address") or "").lower(),
            "label": "request",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_hex": _ancillary_to_hex(ad),
            "ancillary_raw": raw,
            "requester": args.get("requester"),
            "proposer": None,
            "disputer": None,
            "settlement_recipient": None,
            "proposedPrice": None,
            "price": None,
            "payout": None,
            "description": desc, "p1": p1, "p2": p2,
            "request_tx": tx, "proposal_tx": None, "settlement_tx": None,
        }
    except Exception as e:
        print(f"Decode RequestPrice error: {e}", file=sys.stderr)
        return None


def decode_propose_price(log: Dict, w3: Web3, block_ts_cache: Dict[int, str]) -> Optional[Dict]:
    abi = {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "requester", "type": "address"},
            {"indexed": True, "name": "proposer", "type": "address"},
            {"indexed": False, "name": "identifier", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "ancillaryData", "type": "bytes"},
            {"indexed": False, "name": "proposedPrice", "type": "int256"},
            {"indexed": False, "name": "expirationTimestamp", "type": "uint256"},
            {"indexed": False, "name": "currency", "type": "address"},
        ],
        "name": "ProposePrice",
        "type": "event",
    }
    try:
        decoded = w3.eth.contract(abi=[abi]).events.ProposePrice().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData") or b""
        raw = _ancillary_to_utf8(ad)
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        prop = args.get("proposedPrice")
        prop_val = int(prop) if prop is not None and hasattr(prop, "__int__") else None
        return {
            "block_number": log["blockNumber"],
            "log_index": int(log.get("logIndex", 0) or 0),
            "event_time": _block_ts(w3, log["blockNumber"], block_ts_cache),
            "tx_hash": tx,
            "source_oracle": str(log.get("_source_address") or log.get("address") or "").lower(),
            "label": "propose",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_hex": _ancillary_to_hex(ad),
            "ancillary_raw": raw,
            "requester": args.get("requester"),
            "proposer": args.get("proposer"),
            "disputer": None,
            "settlement_recipient": None,
            "proposedPrice": prop_val,
            "price": None,
            "payout": None,
            "description": desc, "p1": p1, "p2": p2,
            "request_tx": None, "proposal_tx": tx, "settlement_tx": None,
        }
    except Exception as e:
        print(f"Decode ProposePrice error: {e}", file=sys.stderr)
        return None


def decode_dispute_price(log: Dict, w3: Web3, block_ts_cache: Dict[int, str]) -> Optional[Dict]:
    abi = {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "requester", "type": "address"},
            {"indexed": True, "name": "proposer", "type": "address"},
            {"indexed": True, "name": "disputer", "type": "address"},
            {"indexed": False, "name": "identifier", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "ancillaryData", "type": "bytes"},
            {"indexed": False, "name": "proposedPrice", "type": "int256"},
        ],
        "name": "DisputePrice",
        "type": "event",
    }
    try:
        decoded = w3.eth.contract(abi=[abi]).events.DisputePrice().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData") or b""
        raw = _ancillary_to_utf8(ad)
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        prop = args.get("proposedPrice")
        prop_val = int(prop) if prop is not None and hasattr(prop, "__int__") else None
        return {
            "block_number": log["blockNumber"],
            "log_index": int(log.get("logIndex", 0) or 0),
            "event_time": _block_ts(w3, log["blockNumber"], block_ts_cache),
            "tx_hash": tx,
            "source_oracle": str(log.get("_source_address") or log.get("address") or "").lower(),
            "label": "dispute",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_hex": _ancillary_to_hex(ad),
            "ancillary_raw": raw,
            "requester": args.get("requester"),
            "proposer": args.get("proposer"),
            "disputer": args.get("disputer"),
            "settlement_recipient": None,
            "proposedPrice": prop_val,
            "price": None,
            "payout": None,
            "description": desc, "p1": p1, "p2": p2,
            "request_tx": None, "proposal_tx": None, "settlement_tx": None,
        }
    except Exception as e:
        print(f"Decode DisputePrice error: {e}", file=sys.stderr)
        return None


def decode_settle(log: Dict, w3: Web3, block_ts_cache: Dict[int, str]) -> Optional[Dict]:
    abi = {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "requester", "type": "address"},
            {"indexed": True, "name": "proposer", "type": "address"},
            {"indexed": True, "name": "disputer", "type": "address"},
            {"indexed": False, "name": "identifier", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "ancillaryData", "type": "bytes"},
            {"indexed": False, "name": "price", "type": "int256"},
            {"indexed": False, "name": "payout", "type": "uint256"},
        ],
        "name": "Settle",
        "type": "event",
    }
    try:
        decoded = w3.eth.contract(abi=[abi]).events.Settle().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData") or b""
        raw = _ancillary_to_utf8(ad)
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        price = args.get("price")
        payout = args.get("payout")
        price_val = int(price) if price is not None and hasattr(price, "__int__") else None
        payout_val = int(payout) if payout is not None and hasattr(payout, "__int__") else None
        return {
            "block_number": log["blockNumber"],
            "log_index": int(log.get("logIndex", 0) or 0),
            "event_time": _block_ts(w3, log["blockNumber"], block_ts_cache),
            "tx_hash": tx,
            "source_oracle": str(log.get("_source_address") or log.get("address") or "").lower(),
            "label": "settle",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_hex": _ancillary_to_hex(ad),
            "ancillary_raw": raw,
            "requester": args.get("requester"),
            "proposer": args.get("proposer"),
            "disputer": args.get("disputer"),
            "settlement_recipient": args.get("proposer"),
            "proposedPrice": None,
            "price": price_val,
            "payout": payout_val,
            "description": desc, "p1": p1, "p2": p2,
            "request_tx": None, "proposal_tx": None, "settlement_tx": tx,
        }
    except Exception as e:
        print(f"Decode Settle error: {e}", file=sys.stderr)
        return None


def _fill_requester_from_tx(w3: Web3, tx_hash: str) -> Optional[str]:
    try:
        tx = w3.eth.get_transaction(tx_hash)
        return tx.get("from") if tx else None
    except Exception:
        return None


def _ensure_0x(s: Any) -> str:
    if s is None or s == "":
        return ""
    h = s.hex() if hasattr(s, "hex") else str(s)
    return h if h.startswith("0x") else "0x" + h


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _key(e: Dict) -> Tuple[Any, Any, bytes]:
    return (
        e.get("source_oracle") or "",
        e.get("identifier"),
        e.get("timestamp"),
        e.get("ancillaryData") or b"",
    )


def run(
    rpc_url: Optional[str] = None,
    adapter_start_block: Optional[int] = None,
    oracle_start_block: Optional[int] = None,
    end_block: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    output_path: Optional[str] = None,
    limit: Optional[int] = None,
    db_path: Optional[str] = None,
    adapter_addresses_raw: Optional[str] = None,
    oracle_addresses_raw: Optional[str] = None,
    continue_sync: bool = False,
    batch_adapter: int = BATCH_BLOCKS_ADAPTER,
    batch_oracle: int = BATCH_BLOCKS_ORACLE,
    max_workers: int = 30,
    sync_state_key: str = ORACLE_SYNC_STATE_KEY,
) -> str:
    rpc_url = rpc_url or get_rpc_url()
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if ExtraDataToPOAMiddleware:
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to RPC: {rpc_url}")

    db_path = db_path or os.environ.get("POLYMARKET_DB", POLYMARKET_DB)
    db_path = str(Path(db_path).expanduser().resolve())
    db_exists = Path(db_path).exists()
    adapter_addresses = _parse_address_list(adapter_addresses_raw, DEFAULT_ADAPTER_ADDRESSES)
    oracle_addresses = _parse_address_list(oracle_addresses_raw, DEFAULT_ORACLE_ADDRESSES)

    if continue_sync and (start_date or end_date):
        raise ValueError("--continue-sync 与 --start/--end 不能同时使用")

    # 日期转区块
    if start_date or end_date:
        if not start_date or not end_date:
            raise ValueError("--start 和 --end 必须同时指定")
        ts_start = _parse_date_to_timestamp(start_date)
        _end = end_date.strip()
        ts_end = _parse_date_to_timestamp(_end + " 23:59:59" if len(_end) == 10 else _end)
        latest = w3.eth.block_number
        oracle_start_block = _block_at_timestamp(w3, ts_start - 1, high=latest) + 1
        end_block = _block_at_timestamp(w3, ts_end, high=latest)
        print(f"日期 {start_date} ~ {end_date} -> 区块 {oracle_start_block} ~ {end_block}", file=sys.stderr)
    if end_block is None:
        end_block = w3.eth.block_number
    if continue_sync and oracle_start_block is None:
        last = get_last_oracle_synced_block(db_path, sync_state_key=sync_state_key) if db_exists else None
        if last is not None:
            oracle_start_block = last + 1
            print(f"[continue-sync] Resuming oracle sync from block {oracle_start_block}", file=sys.stderr)
        else:
            print("[continue-sync] No previous oracle sync found — falling back to default start block logic.", file=sys.stderr)
    if oracle_start_block is None:
        earliest_market_created_at = _get_earliest_market_created_at(db_path) if db_exists else None
        if earliest_market_created_at:
            earliest_dt = _parse_any_datetime(earliest_market_created_at)
            if earliest_dt is not None:
                oracle_start_block = _block_at_timestamp(w3, int(earliest_dt.timestamp()), high=end_block)
                print(
                    f"数据库最早市场 created_at={earliest_market_created_at} -> 起始区块 {oracle_start_block}",
                    file=sys.stderr,
                )
            else:
                oracle_start_block = max(0, end_block - 500_000)
        else:
            oracle_start_block = max(0, end_block - 500_000)
    if adapter_start_block is None:
        adapter_start_block = oracle_start_block

    # Step 1 & 2: 复用历史 SQLite 映射，并增量补充最近 QuestionInitialized
    adapter_map: Dict[str, str] = {}
    adapter_map_source: Dict[str, str] = {}
    if db_exists:
        conn_map = _connect_sqlite_write(db_path)
        try:
            init_uma_adapter_mapping(conn_map)
            adapter_map = load_adapter_mapping(conn_map)
            if adapter_map:
                print(f"Loaded persisted adapter mapping rows: {len(adapter_map)}", file=sys.stderr)
        finally:
            conn_map.close()

    recent_adapter_map, recent_adapter_source = build_adapter_mapping(
        w3,
        adapter_start_block,
        end_block,
        adapter_addresses=adapter_addresses,
        batch_blocks=batch_adapter,
        max_workers=max_workers,
    )
    adapter_map.update(recent_adapter_map)
    adapter_map_source.update(recent_adapter_source)
    if db_exists and recent_adapter_map:
        conn_map = _connect_sqlite_write(db_path)
        try:
            init_uma_adapter_mapping(conn_map)
            changed = save_adapter_mapping_entries(conn_map, recent_adapter_map)
            print(f"Persisted adapter mapping changes: {changed}", file=sys.stderr)
        finally:
            conn_map.close()

    market_bridge = None
    if db_exists:
        try:
            market_bridge = _load_market_bridge_indices(db_path)
            print(
                "Loaded DB bridge indexes: "
                f"gamma_market_id={len(market_bridge['by_gamma_market_id'])}, "
                f"condition_id={len(market_bridge['by_condition_id'])}, "
                f"title_keys={len(market_bridge['by_title_buckets'])}, "
                f"question_id={len(market_bridge['by_question_id'])}",
                file=sys.stderr,
            )
        except Exception as e:
            print(f"Load DB bridge indexes failed: {e}", file=sys.stderr)

    # Step 3: 抓取 UMA Oracle 事件
    all_topics = [_topic0(EVENT_SIGNATURES[k]) for k in ("request", "propose", "dispute", "settle")]
    decoders = {
        _topic0(EVENT_SIGNATURES["request"]): decode_request_price,
        _topic0(EVENT_SIGNATURES["propose"]): decode_propose_price,
        _topic0(EVENT_SIGNATURES["dispute"]): decode_dispute_price,
        _topic0(EVENT_SIGNATURES["settle"]): decode_settle,
    }
    print(f"Fetching UMA Oracle logs {oracle_start_block}-{end_block} (batch={batch_oracle})...", file=sys.stderr)
    logs = fetch_logs_many_addresses(
        w3,
        oracle_start_block,
        end_block,
        oracle_addresses,
        all_topics,
        batch_blocks=batch_oracle,
        max_logs=MAX_LOGS,
        max_workers=max_workers,
        label="UMA Oracle events",
    )

    # ================= 核心优化 1：高并发预取所有独立区块的时间戳 =================
    unique_blocks = list(set(log["blockNumber"] for log in logs if "blockNumber" in log))
    block_ts_cache: Dict[int, str] = {}
    if unique_blocks:
        nw = max_workers
        print(f"  ... 准备预取 {len(unique_blocks)} 个独立区块的时间戳 ({nw}线程并发)...", file=sys.stderr)

        def _fetch_ts(b_num):
            return b_num, get_block_timestamp(w3, b_num)

        with ThreadPoolExecutor(max_workers=nw) as executor:
            future_to_block = {executor.submit(_fetch_ts, b): b for b in unique_blocks}
            completed = 0
            for future in as_completed(future_to_block):
                b_num, ts = future.result()
                block_ts_cache[b_num] = ts or ""
                completed += 1
                if completed % max(1, len(unique_blocks) // 10) == 0 or completed == len(unique_blocks):
                    progress = (completed / len(unique_blocks)) * 100
                    print(f"  ---> 区块时间预取进度: {completed}/{len(unique_blocks)} ({progress:.1f}%)", file=sys.stderr)

    # ================= 解析日志 (此时查 cache 秒出，不再卡顿) =================
    print(f"  ... 开始解析 {len(logs)} 条日志...", file=sys.stderr)
    rows: List[Dict] = []
    for log in logs:
        top = log.get("topics") or []
        topic0_raw = top[0] if top else None
        topic0 = topic0_raw.hex() if hasattr(topic0_raw, "hex") else (topic0_raw or "")
        if topic0 and not topic0.startswith("0x"):
            topic0 = "0x" + topic0
        if topic0 not in decoders:
            continue
        d = decoders[topic0](log, w3, block_ts_cache)
        if d:
            rows.append(d)

    # ================= 核心优化 2：高并发预取 Request 交易的发起者 =================
    request_txs = list(set(r["tx_hash"] for r in rows if r["label"] == "request" and r.get("tx_hash")))
    tx_sender_cache: Dict[str, str] = {}
    if request_txs:
        nw = max_workers
        print(f"  ... 准备预取 {len(request_txs)} 笔 Request 交易的发起者 ({nw}线程并发)...", file=sys.stderr)

        def _fetch_tx_sender(tx_hash):
            for attempt in range(3):
                try:
                    tx = w3.eth.get_transaction(tx_hash)
                    return tx_hash, tx.get("from") if tx else None
                except Exception:
                    time.sleep(1)
            return tx_hash, None

        with ThreadPoolExecutor(max_workers=nw) as executor:
            future_to_tx = {executor.submit(_fetch_tx_sender, tx): tx for tx in request_txs}
            completed = 0
            for future in as_completed(future_to_tx):
                tx_h, sender = future.result()
                tx_sender_cache[tx_h] = sender or ""
                completed += 1
                if completed % max(1, len(request_txs) // 10) == 0 or completed == len(request_txs):
                    progress = (completed / len(request_txs)) * 100
                    print(f"  ---> 交易 Sender 预取进度: {completed}/{len(request_txs)} ({progress:.1f}%)", file=sys.stderr)

    def _fast_fill_requester(tx_hash: str) -> Optional[str]:
        return tx_sender_cache.get(tx_hash) or None

    # ================= 分组填充 (现在纯内存运算，0 RPC) =================
    by_key: Dict[Tuple, List[Dict]] = {}
    for r in rows:
        k = _key(r)
        if k not in by_key:
            by_key[k] = []
        by_key[k].append(r)

    for k, group in by_key.items():
        request_tx = proposal_tx = settlement_tx = requester = proposer = disputer = None
        settlement_recipient = None
        proposed_price = settled_price = payout = None
        for r in group:
            if r["label"] == "request":
                request_tx = r.get("tx_hash") or r.get("request_tx")
                requester = requester or _fast_fill_requester(request_tx or "")
            elif r["label"] == "propose":
                proposal_tx = r.get("tx_hash") or r.get("proposal_tx")
                proposer = proposer or r.get("proposer")
                if r.get("proposedPrice") is not None:
                    proposed_price = r["proposedPrice"]
            elif r["label"] == "dispute":
                disputer = disputer or r.get("disputer")
                if r.get("proposedPrice") is not None:
                    proposed_price = proposed_price or r["proposedPrice"]
            elif r["label"] == "settle":
                settlement_tx = r.get("tx_hash") or r.get("settlement_tx")
                settlement_recipient = settlement_recipient or r.get("settlement_recipient") or r.get("proposer")
                if r.get("price") is not None:
                    settled_price = r["price"]
                if r.get("payout") is not None:
                    payout = r["payout"]
        for r in group:
            r["request_tx"] = r.get("request_tx") or request_tx
            r["proposal_tx"] = r.get("proposal_tx") or proposal_tx
            r["settlement_tx"] = r.get("settlement_tx") or settlement_tx
            r["requester"] = r.get("requester") or requester
            r["proposer"] = r.get("proposer") or proposer
            r["disputer"] = r.get("disputer") or disputer
            r["settlement_recipient"] = r.get("settlement_recipient") or settlement_recipient
            if r["label"] in ("propose", "dispute") and proposed_price is not None:
                r["proposedPrice"] = r.get("proposedPrice") if r.get("proposedPrice") is not None else proposed_price
            if r["label"] == "settle":
                r["price"] = r.get("price") if r.get("price") is not None else settled_price
                r["payout"] = r.get("payout") if r.get("payout") is not None else payout

    # Step 4 & 5: 字典映射合并 + 直接写库（可选调试导出）
    match_stats = {
        "by_gamma_market_id": 0,
        "by_title": 0,
        "by_title_nearest_date": 0,
        "by_condition_id": 0,
        "by_question_id": 0,
        "unmatched": 0,
    }
    sorted_rows = sorted(rows, key=lambda x: (-x["block_number"], x["tx_hash"]))
    db_writer = _OracleDbWriter(db_path)
    file_writer = _RecordWriter(output_path) if output_path else None
    for r in sorted_rows:
        ancillary_hex = r.get("ancillary_hex") or _ancillary_to_hex(r.get("ancillaryData") or b"")
        real_qid = adapter_map.get(ancillary_hex.lower()) or adapter_map.get(ancillary_hex) or ""
        source_adapter = adapter_map_source.get(ancillary_hex.lower()) or adapter_map_source.get(ancillary_hex) or ""
        chain_question_id = ""
        if real_qid:
            chain_question_id = real_qid
        else:
            iden = r.get("identifier")
            if iden is not None:
                h = iden.hex() if hasattr(iden, "hex") else str(iden)
                if not h.startswith("0x"):
                    h = "0x" + h
                chain_question_id = h[:66]
            else:
                ad = r.get("ancillaryData") or b""
                chain_question_id = "0x" + Web3.keccak(primitive=ad).hex()[:64] if ad else ""

        raw = r.get("ancillary_raw") or ""
        ext_market_id = _extract_market_id(raw)
        ext_title = _extract_title(raw)
        ext_title_norm = _normalize_title(ext_title)

        matched_market: Optional[Dict[str, Any]] = None
        matched_by = ""
        if market_bridge:
            if ext_market_id and ext_market_id in market_bridge["by_gamma_market_id"]:
                matched_market = market_bridge["by_gamma_market_id"][ext_market_id]
                matched_by = "by_gamma_market_id"
                match_stats["by_gamma_market_id"] += 1
            elif ext_title_norm:
                matched_market, matched_by = _select_market_by_title(
                    market_bridge["by_title_buckets"].get(ext_title_norm, []),
                    r.get("event_time", ""),
                )
                if matched_by:
                    match_stats[matched_by] += 1
            if matched_market is None and chain_question_id and chain_question_id.lower() in market_bridge["by_condition_id"]:
                matched_market = market_bridge["by_condition_id"][chain_question_id.lower()]
                matched_by = "by_condition_id"
                match_stats["by_condition_id"] += 1
            if matched_market is None and chain_question_id and chain_question_id.lower() in market_bridge["by_question_id"]:
                matched_market = market_bridge["by_question_id"][chain_question_id.lower()]
                matched_by = "question_id"
                match_stats["by_question_id"] += 1
            if matched_market is None:
                match_stats["unmatched"] += 1

        if matched_market:
            question_id = matched_market.get("question_id") or chain_question_id
            condition_id = matched_market.get("condition_id") or question_id
            market_id = matched_market.get("market_id") or ""
            market_title = matched_market.get("title") or ext_title
        else:
            question_id = chain_question_id
            condition_id = chain_question_id
            market_id = ""
            market_title = ext_title

        proposed_price_out = ""
        if r.get("label") in ("propose", "dispute") and r.get("proposedPrice") is not None:
            p = r["proposedPrice"]
            proposed_price_out = str(p / 1e18) if isinstance(p, (int, float)) else str(p)
        settled_price_out = ""
        if r.get("label") == "settle" and r.get("price") is not None:
            p = r["price"]
            settled_price_out = str(p / 1e18) if isinstance(p, (int, float)) else str(p)
        payout_out = str(r["payout"]) if r.get("payout") is not None else ""

        rec = {
            "block_number": r["block_number"],
            "log_index": int(r.get("log_index", 0) or 0),
            "event_time": r["event_time"],
            "tx_hash": _ensure_0x(r["tx_hash"]),
            "event_status": r["label"],
            "external_market_id": _to_text(ext_market_id),
            "market_id": int(market_id) if str(market_id).strip().isdigit() else None,
            "market_title": _to_text(market_title),
            "source_adapter": _to_text(source_adapter),
            "source_oracle": _to_text(r.get("source_oracle") or ""),
            "adapter_question_id": _to_text(chain_question_id),
            "matched_by": matched_by,
            "question_id": _to_text(question_id),
            "condition_id": _to_text(condition_id),
            "string_raw": _to_text(raw),
            "p1": _to_text(r.get("p1") or ""),
            "p2": _to_text(r.get("p2") or ""),
            "proposed_price": _to_text(proposed_price_out),
            "settled_price": _to_text(settled_price_out),
            "settlement_recipient": (r.get("settlement_recipient") or "").lower() if r.get("settlement_recipient") else "",
            "payout": _to_text(payout_out),
            "requester": (r.get("requester") or "").lower() if r.get("requester") else "",
            "proposer": (r.get("proposer") or "").lower() if r.get("proposer") else "",
            "disputer": (r.get("disputer") or "").lower() if r.get("disputer") else "",
            "request_transaction": _ensure_0x(r.get("request_tx") or ""),
            "proposal_transaction": _ensure_0x(r.get("proposal_tx") or ""),
            "settlement_transaction": _ensure_0x(r.get("settlement_tx") or ""),
        }
        db_writer.write(rec)
        if file_writer is not None:
            file_writer.write({**rec, "market_id": _to_text(rec["market_id"])})
        if db_writer.total % PARQUET_WRITE_BATCH == 0:
            print(f"  ---> 已写入数据库 {db_writer.total} 条 oracle 事件", file=sys.stderr)
        if limit is not None and db_writer.total >= limit:
            break

    db_writer.close()
    if file_writer is not None:
        file_writer.close()
    print(
        "DB bridge match stats: "
        f"gamma_market_id={match_stats['by_gamma_market_id']}, "
        f"title={match_stats['by_title']}, "
        f"title_nearest_date={match_stats['by_title_nearest_date']}, "
        f"condition_id={match_stats['by_condition_id']}, "
        f"question_id={match_stats['by_question_id']}, "
        f"unmatched={match_stats['unmatched']}",
        file=sys.stderr,
    )
    save_oracle_synced_block(db_path, end_block, sync_state_key=sync_state_key)
    print(f"Saved oracle sync checkpoint: last_block={end_block}", file=sys.stderr)
    print(
        f"Wrote {db_writer.total} oracle event records into {describe_db_target()} / oracle_events",
        file=sys.stderr,
    )
    if file_writer is not None:
        print(f"Also exported oracle events to {output_path}", file=sys.stderr)
    return db_path


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="UMA Oracle 链上拉取：多 adapter + 多 oracle 地址并集抓取，直接写入 oracle_events"
    )
    parser.add_argument("--rpc", default=None, help="RPC URL")
    parser.add_argument("--adapter-start-block", type=int, default=None,
        help="QuestionInitialized 起始区块，建议早于 oracle-start-block")
    parser.add_argument("--oracle-start-block", type=int, default=None,
        help="Oracle 事件起始区块")
    parser.add_argument("--end-block", type=int, default=None, help="结束区块 (default: latest)")
    parser.add_argument("--start", default=None, help='起始日期 "YYYY-MM-DD"')
    parser.add_argument("--end", dest="end_date", default=None, help='结束日期 "YYYY-MM-DD"')
    parser.add_argument("--output", "-o", default=None, help="可选调试导出路径；不传则只写数据库")
    parser.add_argument("--limit", type=int, default=None, help="最大输出条数，默认不限")
    add_db_cli_args(parser)
    parser.add_argument("--continue-sync", action="store_true", help="从 sync_state.oracle_sync 记录的上次区块继续同步")
    parser.add_argument(
        "--adapter-addresses",
        default=",".join(DEFAULT_ADAPTER_ADDRESSES),
        help="逗号分隔的 UmaCtfAdapter 地址列表；默认内置多版本地址并集",
    )
    parser.add_argument(
        "--oracle-addresses",
        default=",".join(DEFAULT_ORACLE_ADDRESSES),
        help="逗号分隔的 UMA Oracle 地址列表；默认内置多版本地址并集",
    )
    parser.add_argument("--batch-adapter", type=int, default=BATCH_BLOCKS_ADAPTER,
        help=f"Adapter 每批区块数 (default: {BATCH_BLOCKS_ADAPTER})")
    parser.add_argument("--batch-oracle", type=int, default=BATCH_BLOCKS_ORACLE,
        help=f"Oracle 每批区块数，RPC 限制时改小 (default: {BATCH_BLOCKS_ORACLE})")
    parser.add_argument("--max-workers", type=int, default=30,
        help="并发线程数，Growth 套餐 250 RPS 用 30；若遇 429 可降至 15 (default: 30)")
    args = parser.parse_args()
    configure_db_from_args(args)
    db_path = args.sqlite_path
    print(f"Database target: {describe_db_target()}", file=sys.stderr)
    run(
        rpc_url=args.rpc,
        adapter_start_block=args.adapter_start_block,
        oracle_start_block=args.oracle_start_block,
        end_block=args.end_block,
        start_date=args.start,
        end_date=args.end_date,
        output_path=args.output,
        limit=args.limit,
        db_path=db_path,
        adapter_addresses_raw=args.adapter_addresses,
        oracle_addresses_raw=args.oracle_addresses,
        continue_sync=args.continue_sync,
        batch_adapter=args.batch_adapter,
        batch_oracle=args.batch_oracle,
        max_workers=args.max_workers,
    )


if __name__ == "__main__":
    main()
