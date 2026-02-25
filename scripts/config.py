#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Polymarket 索引器配置

RPC URL 优先从环境变量读取，支持 .env 或系统变量
"""

import os
from pathlib import Path

# 尝试加载 .env（支持 scripts、OGBC 根、链上 polymarket/chainStackNode 等）
_base = Path(__file__).resolve().parent
# 覆盖 workspace 内 polymarket/chainStackNode
_env_paths = [
    _base,
    _base.parent,
    _base.parent / "chainStackNode",
    _base.parent.parent / "chainStackNode",
    _base.parent.parent.parent / "chainStackNode",
]
for _p in _env_paths:
    if not _p or not _p.exists():
        continue
    _env = _p / ".env"
    if _env.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(_env)
        except ImportError:
            pass
        break

# 默认 Polygon RPC（公开节点，无密钥）
# 使用 Chainstack 等带 key 的 RPC 时，请设置环境变量 NODE_URL 或 POLYMARKET_RPC_URL（或 .env），勿将 key 提交到仓库
DEFAULT_RPC_URL = "https://polygon-rpc.com"

# 环境变量名（可与 chainStackNode/.env 中的 NODE_URL 一致）
RPC_ENV_KEY = "NODE_URL"
RPC_ENV_ALT = "POLYMARKET_RPC_URL"


def get_rpc_url() -> str:
    """
    获取 Polygon RPC URL
    优先级：POLYMARKET_RPC_URL > NODE_URL > 默认 Chainstack URL
    """
    url = os.environ.get(RPC_ENV_ALT) or os.environ.get(RPC_ENV_KEY)
    if url:
        # 处理 .env 中可能带引号的值
        return url.strip().strip('"').strip("'")
    return DEFAULT_RPC_URL
