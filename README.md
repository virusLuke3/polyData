# polyData

Polymarket 链上/API 数据管道：市场发现、交易索引、数据库与查询 API。

## 目录结构

- **`webpage/`** — 前端页面（市场列表等）
- **`database/`** — SQLite 数据库与 JSON 数据文件
- **`document/`** — 所有 Markdown 文档与说明
- **`scripts/`** — 脚本
  - **`scripts/market/`** — 市场相关（market_discovery, market_decoder, fetch_recent_markets）
  - **`scripts/trade/`** — 交易相关（trades_indexer, trade_decoder）
  - **`scripts/db/`** — 数据库相关（db 模块, verify_db, test_db_coverage）
  - `config.py`、`api_server.py`、`requirements.txt` 等仍在 `scripts/` 根目录

运行脚本时请在仓库根目录执行，或先 `cd scripts` 再执行（如 `python trade/trades_indexer.py` 或 `python -m trade.trades_indexer` 需在 scripts 下并设置 `PYTHONPATH=.`）。数据库默认路径为 `database/polymarket_indexer.db`。

详细说明见 **`document/`** 下各文档。
