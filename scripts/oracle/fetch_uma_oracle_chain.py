#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UMA Optimistic Oracle 链上数据拉取

替代 Dune 的 duneUMA.sql：通过 Chainstack RPC 直接从 Polygon 拉取
RequestPrice / ProposePrice / DisputePrice / Settle 事件，解析 ancillaryData，
输出与 Dune 查询结果一致的 JSON 到 database/oracle.json。
"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone

# 保证 scripts 根目录在 path 中
_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    from web3 import Web3
except ImportError:
    print("Error: web3 not installed. pip install web3", file=sys.stderr)
    sys.exit(1)

try:
    from web3.middleware import ExtraDataToPOAMiddleware as geth_poa_middleware
except ImportError:
    try:
        from web3.middleware import geth_poa_middleware
    except ImportError:
        geth_poa_middleware = None

from config import get_rpc_url

# Polymarket UMA CTF Adapter（Polygon）— 实际发出 Settle/Request/Propose 等事件的合约
# 从 tx 0xf78b... 的 Event Logs 可见：Settle 由 0xeE3Afe347D5C74317041E2618C49534dAf887c24 发出
UMA_ORACLE_ADDRESS = "0xeE3Afe347D5C74317041E2618C49534dAf887c24"

# 事件签名：此合约使用带 indexed requester/proposer/disputer 的 Settle
# Settle(address requester, address proposer, address disputer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 price, uint256 payout)
EVENT_SIGNATURES = {
    "request": "RequestPrice(bytes32,uint256,bytes,address,uint256)",
    "propose": "ProposePrice(bytes32,uint256,bytes,int256,uint256,address)",
    "dispute": "DisputePrice(bytes32,uint256,bytes,int256,uint256,address)",
    "settle": "Settle(address,address,address,bytes32,uint256,bytes,int256,uint256)",
}

# 默认拉取最近 N 个区块（约 50 条事件需视区块活动调整）
DEFAULT_FROM_BLOCK_OFFSET = 500_000
# Chainstack 等 RPC 有 block range 限制（常见 100~500），单次不宜过大
BATCH_BLOCKS = 50
MAX_LOGS = 500
OUTPUT_COLS = [
    "block_number", "event_time", "tx_hash", "event_status",
    "condition_id", "question_id", "description", "p1", "p2",
    "requester", "proposer", "disputer", "settlement_recipient",
    "request_transaction", "proposal_transaction", "settlement_transaction",
    "proposed_price", "settled_price", "payout", "string_raw",
]


def _topic0(sig: str) -> str:
    return "0x" + Web3.keccak(text=sig).hex()


def _ancillary_to_utf8(data: bytes) -> str:
    if not data:
        return ""
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _parse_question_raw(raw: str) -> Tuple[str, str, str]:
    """从 question_raw_text 提取 description, p1, p2（与 SQL regex 一致）"""
    desc = ""
    p1_val = ""
    p2_val = ""
    if not raw:
        return desc, p1_val, p2_val
    # description: ... (至 market_id: 或结尾)
    m = re.search(r"(?s)description:\s*(.*?)(?:\s*market_id:|$)", raw)
    if m:
        desc = m.group(1).strip()
    # p1: 数字
    m1 = re.search(r"p1:\s*([0-9]+)", raw)
    if m1:
        p1_val = m1.group(1)
    m2 = re.search(r"p2:\s*([0-9]+)", raw)
    if m2:
        p2_val = m2.group(1)
    return desc, p1_val, p2_val


def _block_timestamp(w3: Web3, block_number: int) -> str:
    try:
        block = w3.eth.get_block(block_number)
        if block and block.get("timestamp") is not None:
            ts = block["timestamp"]
            return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000 UTC")
    except Exception:
        pass
    return ""


def fetch_logs(
    w3: Web3,
    from_block: int,
    to_block: int,
    address: str,
    topics: List[str],
    batch_blocks: int = BATCH_BLOCKS,
) -> List[Dict]:
    logs = []
    current = from_block
    while current <= to_block:
        end = min(current + batch_blocks - 1, to_block)
        try:
            batch = w3.eth.get_logs({
                "address": Web3.to_checksum_address(address),
                "fromBlock": current,
                "toBlock": end,
                "topics": [topics],
            })
            logs.extend([dict(l) for l in batch])
        except Exception as e:
            print(f"get_logs {current}-{end} failed: {e}", file=sys.stderr)
        current = end + 1
        if len(logs) >= MAX_LOGS:
            break
    return logs[:MAX_LOGS]


def decode_request_price(log: Dict, w3: Web3) -> Optional[Dict]:
    # RequestPrice(bytes32 identifier, uint256 timestamp, bytes ancillaryData, address currency, uint256 reward)
    abi = {
        "inputs": [
            {"name": "identifier", "type": "bytes32"},
            {"name": "timestamp", "type": "uint256"},
            {"name": "ancillaryData", "type": "bytes"},
            {"name": "currency", "type": "address"},
            {"name": "reward", "type": "uint256"},
        ],
        "name": "RequestPrice",
        "type": "event",
    }
    try:
        contract = w3.eth.contract(abi=[abi])
        decoded = contract.events.RequestPrice().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData", b"")
        raw = _ancillary_to_utf8(ad) if isinstance(ad, bytes) else _ancillary_to_utf8(ad or b"")
        desc, p1, p2 = _parse_question_raw(raw)
        return {
            "block_number": log["blockNumber"],
            "event_time": _block_timestamp(w3, log["blockNumber"]),
            "tx_hash": log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"],
            "label": "request",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_raw": raw,
            "requester": None,
            "proposer": None,
            "disputer": None,
            "proposedPrice": None,
            "price": None,
            "payout": None,
            "description": desc,
            "p1": p1,
            "p2": p2,
            "request_tx": log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"],
            "proposal_tx": None,
            "settlement_tx": None,
        }
    except Exception as e:
        print(f"Decode RequestPrice error: {e}", file=sys.stderr)
        return None


def decode_propose_price(log: Dict, w3: Web3) -> Optional[Dict]:
    # ProposePrice(bytes32, uint256, bytes, int256 proposedPrice, uint256 expirationTimestamp, address proposer)
    abi = {
        "inputs": [
            {"name": "identifier", "type": "bytes32"},
            {"name": "timestamp", "type": "uint256"},
            {"name": "ancillaryData", "type": "bytes"},
            {"name": "proposedPrice", "type": "int256"},
            {"name": "expirationTimestamp", "type": "uint256"},
            {"name": "proposer", "type": "address"},
        ],
        "name": "ProposePrice",
        "type": "event",
    }
    try:
        contract = w3.eth.contract(abi=[abi])
        decoded = contract.events.ProposePrice().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData", b"")
        raw = _ancillary_to_utf8(ad) if isinstance(ad, bytes) else _ancillary_to_utf8(ad or b"")
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        prop_price = args.get("proposedPrice")
        if prop_price is not None and hasattr(prop_price, "__int__"):
            prop_price = int(prop_price)
        return {
            "block_number": log["blockNumber"],
            "event_time": _block_timestamp(w3, log["blockNumber"]),
            "tx_hash": tx,
            "label": "propose",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_raw": raw,
            "requester": None,
            "proposer": args.get("proposer"),
            "disputer": None,
            "proposedPrice": prop_price,
            "price": None,
            "payout": None,
            "description": desc,
            "p1": p1,
            "p2": p2,
            "request_tx": None,
            "proposal_tx": tx,
            "settlement_tx": None,
        }
    except Exception as e:
        print(f"Decode ProposePrice error: {e}", file=sys.stderr)
        return None


def decode_dispute_price(log: Dict, w3: Web3) -> Optional[Dict]:
    abi = {
        "inputs": [
            {"name": "identifier", "type": "bytes32"},
            {"name": "timestamp", "type": "uint256"},
            {"name": "ancillaryData", "type": "bytes"},
            {"name": "proposedPrice", "type": "int256"},
            {"name": "expirationTimestamp", "type": "uint256"},
            {"name": "disputer", "type": "address"},
        ],
        "name": "DisputePrice",
        "type": "event",
    }
    try:
        contract = w3.eth.contract(abi=[abi])
        decoded = contract.events.DisputePrice().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData", b"")
        raw = _ancillary_to_utf8(ad) if isinstance(ad, bytes) else _ancillary_to_utf8(ad or b"")
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        prop_price = args.get("proposedPrice")
        if prop_price is not None and hasattr(prop_price, "__int__"):
            prop_price = int(prop_price)
        return {
            "block_number": log["blockNumber"],
            "event_time": _block_timestamp(w3, log["blockNumber"]),
            "tx_hash": tx,
            "label": "dispute",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_raw": raw,
            "requester": None,
            "proposer": None,
            "disputer": args.get("disputer"),
            "proposedPrice": prop_price,
            "price": None,
            "payout": None,
            "description": desc,
            "p1": p1,
            "p2": p2,
            "request_tx": None,
            "proposal_tx": None,
            "settlement_tx": None,
        }
    except Exception as e:
        print(f"Decode DisputePrice error: {e}", file=sys.stderr)
        return None


def decode_settle(log: Dict, w3: Web3) -> Optional[Dict]:
    # Settle(address requester, address proposer, address disputer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 price, uint256 payout)
    # 前三个为 indexed，在 topics[1..3]
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
        contract = w3.eth.contract(abi=[abi])
        decoded = contract.events.Settle().process_log(log)
        args = decoded["args"]
        ad = args.get("ancillaryData", b"")
        raw = _ancillary_to_utf8(ad) if isinstance(ad, bytes) else _ancillary_to_utf8(ad or b"")
        desc, p1, p2 = _parse_question_raw(raw)
        tx = log["transactionHash"].hex() if hasattr(log["transactionHash"], "hex") else log["transactionHash"]
        price = args.get("price")
        payout = args.get("payout")
        if price is not None and hasattr(price, "__int__"):
            price = int(price)
        if payout is not None and hasattr(payout, "__int__"):
            payout = int(payout)
        return {
            "block_number": log["blockNumber"],
            "event_time": _block_timestamp(w3, log["blockNumber"]),
            "tx_hash": tx,
            "label": "settle",
            "identifier": args.get("identifier"),
            "timestamp": args.get("timestamp"),
            "ancillaryData": ad,
            "ancillary_raw": raw,
            "requester": args.get("requester"),
            "proposer": args.get("proposer"),
            "disputer": args.get("disputer"),
            "proposedPrice": None,
            "price": price,
            "payout": payout,
            "description": desc,
            "p1": p1,
            "p2": p2,
            "request_tx": None,
            "proposal_tx": None,
            "settlement_tx": tx,
        }
    except Exception as e:
        print(f"Decode Settle error: {e}", file=sys.stderr)
        return None


def _ensure_0x(s: Any) -> str:
    if s is None or s == "":
        return ""
    h = s.hex() if hasattr(s, "hex") else str(s)
    return h if h.startswith("0x") else "0x" + h


def _key(e: Dict) -> Tuple[Any, Any, bytes]:
    iden = e.get("identifier")
    ts = e.get("timestamp")
    ad = e.get("ancillaryData") or b""
    return (iden, ts, ad)


def _fill_requester_from_tx(w3: Web3, tx_hash: str) -> Optional[str]:
    try:
        tx = w3.eth.get_transaction(tx_hash)
        if tx and tx.get("from"):
            return tx["from"]
    except Exception:
        pass
    return None


def run(
    rpc_url: Optional[str] = None,
    from_block: Optional[int] = None,
    to_block: Optional[int] = None,
    output_path: Optional[str] = None,
    limit: int = 50,
    batch_blocks: int = BATCH_BLOCKS,
) -> str:
    rpc_url = rpc_url or get_rpc_url()
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if geth_poa_middleware is not None:
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to RPC: {rpc_url}")

    if to_block is None:
        to_block = w3.eth.block_number
    if from_block is None:
        from_block = max(0, to_block - DEFAULT_FROM_BLOCK_OFFSET)

    address = Web3.to_checksum_address(UMA_ORACLE_ADDRESS)
    all_topics = [_topic0(EVENT_SIGNATURES[k]) for k in ("request", "propose", "dispute", "settle")]

    print(f"Fetching UMA Oracle logs blocks {from_block}-{to_block} (batch={batch_blocks})...", file=sys.stderr)
    logs = fetch_logs(w3, from_block, to_block, address, all_topics, batch_blocks=batch_blocks)
    decoders = {
        _topic0(EVENT_SIGNATURES["request"]): decode_request_price,
        _topic0(EVENT_SIGNATURES["propose"]): decode_propose_price,
        _topic0(EVENT_SIGNATURES["dispute"]): decode_dispute_price,
        _topic0(EVENT_SIGNATURES["settle"]): decode_settle,
    }

    rows: List[Dict] = []
    for log in logs:
        top = log.get("topics") or []
        topic0_raw = top[0] if len(top) > 0 else None
        topic0 = topic0_raw.hex() if hasattr(topic0_raw, "hex") else (topic0_raw if isinstance(topic0_raw, str) else None)
        if topic0 and not topic0.startswith("0x"):
            topic0 = "0x" + topic0
        if not topic0 or topic0 not in decoders:
            continue
        decoded = decoders[topic0](log, w3)
        if decoded:
            rows.append(decoded)

    # 按 (identifier, timestamp, ancillaryData) 分组，填充 requester / request_tx / proposal_tx / settlement_tx
    by_key: Dict[Tuple, List[Dict]] = {}
    for r in rows:
        k = _key(r)
        if k not in by_key:
            by_key[k] = []
        by_key[k].append(r)

    for k, group in by_key.items():
        request_tx = None
        proposal_tx = None
        settlement_tx = None
        requester = None
        proposer = None
        disputer = None
        proposed_price = None
        settled_price = None
        payout = None
        for r in group:
            if r["label"] == "request":
                request_tx = r.get("tx_hash") or r.get("request_tx")
                requester = requester or _fill_requester_from_tx(w3, request_tx or "")
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
            if r["label"] in ("propose", "dispute"):
                r["proposedPrice"] = r.get("proposedPrice") if r.get("proposedPrice") is not None else proposed_price
            if r["label"] == "settle":
                r["price"] = r.get("price") if r.get("price") is not None else settled_price
                r["payout"] = r.get("payout") if r.get("payout") is not None else payout

    # 输出记录：与 Dune SQL 列一致；condition_id/question_id 链上无 Polymarket 映射表，用 keccak(ancillaryData) 占位
    records: List[Dict[str, Any]] = []
    sorted_rows = sorted(rows, key=lambda x: (-x["block_number"], x["tx_hash"]))
    for r in sorted_rows:
        ad = r.get("ancillaryData") or b""
        iden = r.get("identifier")
        if iden is not None:
            iden_hex = iden.hex() if hasattr(iden, "hex") else (iden if isinstance(iden, str) else "")
            if not iden_hex.startswith("0x"):
                iden_hex = "0x" + iden_hex
            condition_id = iden_hex[:66]
            question_id = iden_hex[:66]
        else:
            condition_id = "0x" + Web3.keccak(primitive=ad).hex()[:64] if ad else ""
            question_id = condition_id
        proposed_price_out = ""
        if r.get("label") in ("propose", "dispute") and r.get("proposedPrice") is not None:
            proposed_price_out = str(r["proposedPrice"] / 1e18) if isinstance(r["proposedPrice"], (int, float)) else str(r["proposedPrice"])
        settled_price_out = ""
        if r.get("label") == "settle" and r.get("price") is not None:
            settled_price_out = str(r["price"] / 1e18) if isinstance(r["price"], (int, float)) else str(r["price"])
        payout_out = ""
        if r.get("payout") is not None:
            payout_out = str(r["payout"])

        rec = {
            "block_number": r["block_number"],
            "event_time": r["event_time"],
            "tx_hash": _ensure_0x(r["tx_hash"]),
            "event_status": r["label"],
            "condition_id": condition_id,
            "question_id": question_id,
            "description": r.get("description") or "",
            "p1": r.get("p1") or "",
            "p2": r.get("p2") or "",
            "requester": (r.get("requester") or "").lower() if r.get("requester") else "",
            "proposer": (r.get("proposer") or "").lower() if r.get("proposer") else "",
            "disputer": (r.get("disputer") or "").lower() if r.get("disputer") else "",
            "settlement_recipient": (r.get("proposer") or "").lower() if r.get("proposer") else "",
            "request_transaction": _ensure_0x(r.get("request_tx") or ""),
            "proposal_transaction": _ensure_0x(r.get("proposal_tx") or ""),
            "settlement_transaction": _ensure_0x(r.get("settlement_tx") or ""),
            "proposed_price": proposed_price_out,
            "settled_price": settled_price_out,
            "payout": payout_out,
            "string_raw": (r.get("ancillary_raw") or "")[:500],
        }
        records.append(rec)
        if len(records) >= limit:
            break

    payload = {
        "source": "UMA Optimistic Oracle (chain via Chainstack RPC)",
        "columns": OUTPUT_COLS,
        "records": records,
    }

    out = output_path or str(Path(__file__).resolve().parent.parent.parent / "database" / "oracle.json")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(records)} records to {out}", file=sys.stderr)
    return out


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Fetch UMA Oracle events from chain (Chainstack), output to database/oracle.json")
    parser.add_argument("--rpc", default=None, help="RPC URL (default: config / NODE_URL)")
    parser.add_argument("--from-block", type=int, default=None, help="Start block")
    parser.add_argument("--to-block", type=int, default=None, help="End block (default: latest)")
    parser.add_argument("--output", "-o", default=None, help="Output JSON path (default: database/oracle.json)")
    parser.add_argument("--limit", type=int, default=50, help="Max records to output (default: 50)")
    parser.add_argument("--batch", type=int, default=BATCH_BLOCKS, help="Block range per get_logs batch (default: 50)")
    args = parser.parse_args()
    run(
        rpc_url=args.rpc,
        from_block=args.from_block,
        to_block=args.to_block,
        output_path=args.output,
        limit=args.limit,
        batch_blocks=args.batch,
    )


if __name__ == "__main__":
    main()
