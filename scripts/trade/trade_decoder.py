#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Polymarket 交易日志解码器 (Trade Decoder)

功能：解析 Polygon 链上的 Polymarket 交易日志，提取 OrderFilled 事件并解码为结构化 JSON

使用方法:
    python trade_decoder.py <tx_hash> [--rpc-url <url>] [--output <file.json>]

示例:
    python trade_decoder.py 0xfa0746b1...9198 --rpc-url https://polygon-rpc.com --output trade.json
"""

import json
import sys
import argparse
from typing import List, Dict, Optional
from decimal import Decimal, ROUND_DOWN

try:
    from web3 import Web3
    from web3.exceptions import TransactionNotFound
except ImportError:
    print("Error: web3 library not installed. Please install it with: pip install web3")
    sys.exit(1)


# Polymarket 交易所合约地址
CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"  # 普通二元市场 (CTF Exchange)
NEG_RISK_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a"  # 负风险市场 (NegRisk CTF Exchange)

# OrderFilled 事件签名
# 事件签名: OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)
# 计算方式: keccak256("OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)")
# 注意：这里使用完整的事件签名字符串，Web3会自动计算哈希
ORDER_FILLED_EVENT_SIGNATURE = "OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)"

# USDC 精度（6位小数）
USDC_DECIMALS = 6
USDC_DIVISOR = 10 ** USDC_DECIMALS

# 资产ID为0表示USDC
COLLATERAL_ASSET_ID = "0"


def is_collateral_asset(asset_id: str) -> bool:
    """判断资产ID是否为USDC（抵押品）"""
    return asset_id == COLLATERAL_ASSET_ID or asset_id == "0x0" or asset_id == "0x0000000000000000000000000000000000000000000000000000000000000000"


def decode_order_filled_log(log: Dict, w3: Web3) -> Optional[Dict]:
    """
    解码 OrderFilled 事件日志
    
    Args:
        log: 日志对象
        w3: Web3 实例
    
    Returns:
        解码后的交易信息字典，如果解码失败返回 None
    """
    try:
        # OrderFilled 事件 ABI
        event_abi = {
            "anonymous": False,
            "inputs": [
                {"indexed": True, "name": "orderHash", "type": "bytes32"},
                {"indexed": True, "name": "maker", "type": "address"},
                {"indexed": True, "name": "taker", "type": "address"},
                {"indexed": False, "name": "makerAssetId", "type": "uint256"},
                {"indexed": False, "name": "takerAssetId", "type": "uint256"},
                {"indexed": False, "name": "makerAmountFilled", "type": "uint256"},
                {"indexed": False, "name": "takerAmountFilled", "type": "uint256"},
                {"indexed": False, "name": "fee", "type": "uint256"}
            ],
            "name": "OrderFilled",
            "type": "event"
        }
        
        # 解码日志
        event = w3.eth.contract(abi=[event_abi]).events.OrderFilled()
        decoded = event.process_log(log)
        
        # 提取事件参数
        args = decoded['args']
        
        maker_asset_id = str(args['makerAssetId'])
        taker_asset_id = str(args['takerAssetId'])
        maker_amount = args['makerAmountFilled']
        taker_amount = args['takerAmountFilled']
        
        # 确定 tokenId（非USDC的资产ID）
        if is_collateral_asset(maker_asset_id):
            token_id = taker_asset_id
            usdc_amount = maker_amount
            token_amount = taker_amount
            side = "BUY"  # maker出USDC，买入token
        elif is_collateral_asset(taker_asset_id):
            token_id = maker_asset_id
            usdc_amount = taker_amount
            token_amount = maker_amount
            side = "SELL"  # taker出USDC，maker卖出token
        else:
            # 理论上不应该出现两个都是非零的情况，但处理一下
            print(f"Warning: Both assets are non-zero. Using takerAssetId as tokenId.")
            token_id = taker_asset_id
            usdc_amount = maker_amount  # 假设maker出USDC
            token_amount = taker_amount
            side = "BUY"
        
        # 计算价格：USDC数量 / Token数量
        # 注意：两个数量都需要除以1e6来归一化
        if token_amount > 0:
            price = Decimal(usdc_amount) / Decimal(token_amount)
            # 保留6位小数
            price = price.quantize(Decimal('0.000001'), rounding=ROUND_DOWN)
        else:
            price = Decimal('0')
        
        # 构建结果
        result = {
            "txHash": log['transactionHash'].hex(),
            "logIndex": log['logIndex'],
            "exchange": log['address'],
            "contract": log['address'],
            "orderHash": decoded['args']['orderHash'].hex() if hasattr(decoded['args']['orderHash'], 'hex') else str(decoded['args']['orderHash']),
            "maker": args['maker'],
            "taker": args['taker'],
            "makerAssetId": maker_asset_id,
            "takerAssetId": taker_asset_id,
            "makerAmountFilled": str(maker_amount),
            "takerAmountFilled": str(taker_amount),
            "fee": str(args['fee']),
            "price": str(price),
            "tokenId": token_id,
            "side": side
        }
        
        return result
        
    except Exception as e:
        print(f"Error decoding log: {e}", file=sys.stderr)
        return None


def decode_transaction(tx_hash: str, rpc_url: str = "https://polygon-rpc.com") -> List[Dict]:
    """
    解码交易中的所有 OrderFilled 事件
    
    Args:
        tx_hash: 交易哈希
        rpc_url: Polygon RPC URL
    
    Returns:
        解码后的交易列表
    """
    # 连接到 Polygon
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    
    if not w3.is_connected():
        raise ConnectionError(f"Failed to connect to RPC: {rpc_url}")
    
    # 获取交易回执
    try:
        receipt = w3.eth.get_transaction_receipt(tx_hash)
    except TransactionNotFound:
        raise ValueError(f"Transaction not found: {tx_hash}")
    
    # 计算 OrderFilled 事件的 topic[0] (事件签名的 keccak256 哈希)
    order_filled_topic = w3.keccak(text=ORDER_FILLED_EVENT_SIGNATURE)
    
    # 过滤 OrderFilled 事件
    order_filled_logs = []
    
    # 构建交易所地址列表（用于过滤）
    exchange_addresses = [
        CTF_EXCHANGE_ADDRESS.lower(),
        NEG_RISK_EXCHANGE_ADDRESS.lower()
    ]
    
    for log in receipt['logs']:
        # 检查是否是 OrderFilled 事件（通过 topic[0] 匹配）
        if len(log['topics']) > 0 and log['topics'][0] == order_filled_topic:
            # 检查是否来自 Polymarket 交易所合约
            log_address = log['address'].lower()
            if log_address in exchange_addresses:
                order_filled_logs.append(log)
    
    # 解码所有 OrderFilled 日志
    decoded_trades = []
    for log in order_filled_logs:
        decoded = decode_order_filled_log(log, w3)
        if decoded:
            decoded_trades.append(decoded)
    
    return decoded_trades


def main():
    parser = argparse.ArgumentParser(
        description="Polymarket 交易日志解码器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python trade_decoder.py 0xfa0746b1...9198
  python trade_decoder.py 0xfa0746b1...9198 --rpc-url https://polygon-rpc.com --output trade.json
        """
    )
    
    parser.add_argument(
        "tx_hash",
        help="交易哈希（0x开头）"
    )
    
    parser.add_argument(
        "--rpc-url",
        default="https://polygon-rpc.com",
        help="Polygon RPC URL (默认: https://polygon-rpc.com)"
    )
    
    parser.add_argument(
        "--output",
        "-o",
        help="输出JSON文件路径（如果不指定，输出到stdout）"
    )
    
    args = parser.parse_args()
    
    # 验证交易哈希格式
    if not args.tx_hash.startswith("0x"):
        args.tx_hash = "0x" + args.tx_hash
    
    if len(args.tx_hash) != 66:
        print(f"Error: Invalid transaction hash format: {args.tx_hash}", file=sys.stderr)
        sys.exit(1)
    
    try:
        # 解码交易
        print(f"Decoding transaction: {args.tx_hash}", file=sys.stderr)
        print(f"RPC URL: {args.rpc_url}", file=sys.stderr)
        
        decoded_trades = decode_transaction(args.tx_hash, args.rpc_url)
        
        if not decoded_trades:
            print("No OrderFilled events found in this transaction.", file=sys.stderr)
            sys.exit(1)
        
        # 准备输出
        if len(decoded_trades) == 1:
            output_data = decoded_trades[0]
        else:
            # 多条交易，输出数组
            output_data = {
                "txHash": args.tx_hash,
                "tradeCount": len(decoded_trades),
                "trades": decoded_trades
            }
        
        # 格式化JSON
        output_json = json.dumps(output_data, indent=2, ensure_ascii=False)
        
        # 输出
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output_json)
            print(f"Results saved to: {args.output}", file=sys.stderr)
        else:
            print(output_json)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
