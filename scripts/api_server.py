#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
阶段二 - 任务 C: 查询 API 服务

功能：提供 REST API 查询 markets 和 trades 数据
- GET /markets/{slug} - 市场详情
- GET /markets/{slug}/trades - 该市场历史交易（分页）
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional

# 保证 scripts 根目录在 path 中（支持从仓库根目录运行）
_scripts_root = Path(__file__).resolve().parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    from flask import Flask, jsonify, request
except ImportError:
    print("Error: flask not installed. pip install flask")
    sys.exit(1)

from db import get_connection, dict_from_row, DEFAULT_DB_PATH

app = Flask(__name__)
DB_PATH = os.environ.get("POLYMARKET_DB", DEFAULT_DB_PATH)


def get_market_by_slug(slug: str) -> Optional[dict]:
    """按 slug 查询市场"""
    conn = get_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM markets WHERE slug = ? COLLATE NOCASE LIMIT 1",
        (slug,),
    )
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)


def get_trades_by_market_id(market_id: int, limit: int = 100, offset: int = 0) -> list:
    """按 market_id 分页查询交易"""
    conn = get_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT tx_hash, log_index, maker, taker, price, size, side, outcome,
               timestamp, block_number
        FROM trades
        WHERE market_id = ?
        ORDER BY timestamp DESC, block_number DESC, log_index DESC
        LIMIT ? OFFSET ?
        """,
        (market_id, limit, offset),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


@app.route("/markets/<slug>", methods=["GET"])
def api_market_detail(slug: str):
    """
    GET /markets/{slug}
    返回市场详情，找不到返回 404
    """
    slug = slug.strip()
    if not slug:
        return jsonify({"error": "slug required"}), 400
    
    market = get_market_by_slug(slug)
    if not market:
        return jsonify({"error": "Market not found", "slug": slug}), 404
    
    result = {
        "slug": market["slug"],
        "title": market["title"],
        "conditionId": market["condition_id"],
        "questionId": market["question_id"],
        "oracle": market["oracle"],
        "yesTokenId": market["yes_token_id"],
        "noTokenId": market["no_token_id"],
        "description": market["description"] or "",
        "enableNegRisk": bool(market["enable_neg_risk"]),
        "endDate": market["end_date"],
        "created_at": market["created_at"],
        "category": market.get("category") or "",
        "tags": json.loads(market["tags"]) if isinstance(market.get("tags"), str) else (market.get("tags") or []),
    }
    return jsonify(result)


@app.route("/markets/<slug>/trades", methods=["GET"])
def api_market_trades(slug: str):
    """
    GET /markets/{slug}/trades?limit=100&offset=0
    分页返回该市场的历史交易
    """
    slug = slug.strip()
    if not slug:
        return jsonify({"error": "slug required"}), 400
    
    market = get_market_by_slug(slug)
    if not market:
        return jsonify({"error": "Market not found", "slug": slug}), 404
    
    limit = min(int(request.args.get("limit", 100)), 500)
    offset = max(0, int(request.args.get("offset", 0)))
    
    trades = get_trades_by_market_id(market["id"], limit=limit, offset=offset)
    result = [
        {
            "timestamp": t.get("timestamp"),
            "side": t["side"],
            "outcome": t.get("outcome"),
            "price": t["price"],
            "size": t["size"],
            "maker": t["maker"],
            "taker": t["taker"],
            "tx_hash": t["tx_hash"],
            "log_index": t["log_index"],
        }
        for t in trades
    ]
    return jsonify(result)


@app.route("/health", methods=["GET"])
def health():
    """健康检查"""
    return jsonify({"status": "ok", "db": DB_PATH})


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Polymarket Indexer API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=5000, help="Bind port")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="Database path")
    
    args = parser.parse_args()
    global DB_PATH
    DB_PATH = args.db
    
    print(f"Starting API server at http://{args.host}:{args.port}", file=sys.stderr)
    print(f"Database: {DB_PATH}", file=sys.stderr)
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
