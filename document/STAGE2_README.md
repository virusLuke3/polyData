# 阶段二：Polymarket 链上市场与交易索引器

根据《Polymarket 架构与链上数据解码》阶段二设计实现的索引系统。

## 架构概览

- **数据源**：链上 RPC (OrderFilled 等)、Gamma API（市场元数据）
- **处理管道**：Market Discovery → Trades Indexer → 数据库
- **查询接口**：REST API

## 任务 A: Market Discovery Service

从 Gamma API 发现市场，校验 clobTokenIds。

- **指定 `--db`**：写入数据库
- **不指定 `--db`**：输出为 JSON 文件（默认 `market_discovery.json`），便于查看

### 使用

```bash
# 输出为 JSON（不写库，默认 market_discovery.json，与 fetch_recent_markets 输出不冲突）
python market_discovery.py --limit 100
python market_discovery.py --active-only -o my_markets.json

# 仅已结束市场
python market_discovery.py --closed-only -o closed_markets.json

# 写入数据库（需指定 --db）
python market_discovery.py --db polymarket_indexer.db --limit 500
python market_discovery.py --db polymarket_indexer.db --active-only

# 从 2024-09-01 起按时间向后爬取，不限 limit，活跃+已关闭都拉
# 指定 --db 时每 500 个市场写入一次，自动去重；含重试与请求延时
python market_discovery.py --since-date 2024-09-01 -o markets_since_2024.json
python market_discovery.py --since-date 2024-09-01 --db polymarket_indexer.db
# 仅补充 closed events（断点续传，从上次 offset 继续）
python market_discovery.py --closed-events-only --db polymarket_indexer.db
# 仅拉取 2024-09-01 及之后创建的 closed 市场（过滤历史脏数据）
python market_discovery.py --closed-events-only --db polymarket_indexer.db --since-date 2024-09-01
# 手动指定 closed events 起始 offset
python market_discovery.py --closed-events-only --db polymarket_indexer.db --closed-events-start-offset 23100

# 减轻服务器压力（数据量大时推荐）
# --delay N: 每次请求前等待 N 秒（默认 0.7）
# --cooldown-every N --cooldown-seconds M: 每 N 次请求后暂停 M 秒
# --max-fetches N: 最多请求 N 次后停止并保存进度，可多次运行分批完成

# 指定事件 slug
python market_discovery.py --event-slugs fed-decision-in-january -o fed_markets.json

# 全量估算：市场总数与 DB 大小（不写入文件）
python market_discovery.py --estimate
python market_discovery.py --estimate --estimate-max-pages 50   # 仅抽样 50 页快速估算
```

## 任务 B: Trades Indexer

扫描 Polygon 区块中的 OrderFilled 事件，解码后写入 `trades` 表。

### 使用

```bash
# 指定区块范围
python trades_indexer.py --from-block 40000000 --to-block 40010000

# 测试模式：不写数据库，输出到 JSON 便于查看
python trades_indexer.py --from-block 64000000 --to-block 64001000 --db polymarket_indexer.db --test
# 若 RPC 限流（Block range limit exceeded），加 --batch 500 减小每批区块数
python trades_indexer.py --from-block 64000000 --to-block 64001000 --test trades_sample.json --batch 500

# 从上次进度继续
python trades_indexer.py --continue-sync

# 自定义 RPC
python trades_indexer.py --from-block 40000000 --to-block 40005000 --rpc https://polygon-rpc.com
```

## 任务 C: 查询 API 服务

提供 REST 接口查询市场与交易。

### 使用

```bash
python api_server.py --host 127.0.0.1 --port 5000 --db polymarket_indexer.db
```

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /markets/{slug} | 市场详情 |
| GET | /markets/{slug}/trades?limit=100&offset=0 | 该市场历史交易（分页） |
| GET | /health | 健康检查 |

## 运行顺序

1. **先运行 Market Discovery** 填充市场表
2. **运行 Trades Indexer** 扫描交易
3. **启动 API Server** 供查询

```bash
# 先拉取市场并写入数据库（推荐：从 2024-09-01 起全量爬取）
python market_discovery.py --since-date 2024-09-01 --db polymarket_indexer.db
python trades_indexer.py --from-block 64000000 --db polymarket_indexer.db
python api_server.py --port 5000 --db polymarket_indexer.db
# 访问 http://127.0.0.1:5000/markets/{slug}
```

## 全量市场与 DB 估算

`market_discovery.py --estimate` 分页拉取 Gamma API 统计市场总数及 DB 体积：

- **归一化通过率**：约 85% 的原始市场可通过 Strategy A/B 校验并存储
- **单条记录**：约 1.2–1.5 KB（slug、condition_id、question_id、oracle、yes/no_token_id、title、description 等）
- **实测**（按 volume24hr 排序）：42 页约 4200 条原始、3600 条归一化 → ~5 MB
- **外推**：若全量 2–5 万条市场，markets 表约 **25–75 MB**（不含 trades 等）

- **markets**：市场信息（不含 collateral_token、status、updated_at），condition_id 唯一
- **trades**：(tx_hash, log_index) 唯一，幂等插入
- **sync_state**：trade_sync 记录 last_block，支持断点续传


python market_discovery.py --since-date 2024-09-01 --db polymarket_indexer.db

# 完整拉取（markets + closed events，含重试与延时）
python market_discovery.py --since-date 2024-09-01 --db polymarket_indexer.db

# 仅补充 closed events（自动从上次 offset 继续）
python market_discovery.py --closed-events-only --db polymarket_indexer.db

# 从 offset 23100 开始补充（适用于上次在 offset 23100 失败的情况）
python market_discovery.py --closed-events-only --db polymarket_indexer.db --closed-events-start-offset 23100

# 减轻服务器压力：加大请求间隔、周期性冷却、分批上限
python market_discovery.py --closed-events-only --db polymarket_indexer.db --delay 2
python market_discovery.py --closed-events-only --db polymarket_indexer.db --delay 1.5 --cooldown-every 50 --cooldown-seconds 60
python market_discovery.py --closed-events-only --db polymarket_indexer.db --closed-events-start-offset 23100 --max-fetches 100 --delay 2

# 默认使用 polymarket_indexer.db
python test_db_coverage.py
=== 市场数据覆盖测试 (2024-09-04 至 2026-02-22) ===

采样日期数: 37
有数据的日期: 37
无数据的日期: 0

部分有数据的采样日期及数量:
  2024-09-04: 35 个市场
  2024-09-15: 32 个市场
  2024-10-01: 162 个市场
  2024-10-15: 95 个市场
  2024-11-01: 166 个市场
  2024-11-15: 135 个市场
  2024-12-01: 81 个市场
  2024-12-15: 71 个市场
  2025-01-01: 36 个市场
  2025-01-15: 133 个市场
  2025-02-01: 3 个市场
  2025-02-15: 66 个市场
  2025-03-01: 68 个市场
  2025-03-15: 57 个市场
  2025-04-01: 364 个市场
  ... 共 37 个日期有数据

结论: 所有采样日期均有数据，区间内覆盖良好。

一次性全历史导入（推荐命令）
假设你使用默认数据库路径（database/polymarket_indexer.db）：
cd /home/jiahuaiyu/develop/polymarket/githubProjects/polyDatapython scripts/market/market_discovery.py \  --db database/polymarket_indexer.db \  --since-date 2020-01-01
说明：
--since-date 2020-01-01：从 2020-01-01 开始往后拉取。这个日期早于 Polymarket 实际上线时间即可，脚本会自动按 created_at >= since_date 过滤。
默认会：
从 /markets 分页拉取（按 createdAt 降序）
再从 /events?closed=true 拉取已关闭市场补全
使用你已有的 DB 数据做去重，不会重复插入已存在市场，只会 UPDATE。
之后如果你怀疑 closed events 还有没补全，也可以单独跑一轮补充（可选）：
python scripts/market/market_discovery.py \  --db database/polymarket_indexer.db \  --closed-events-only
后续只拉新增数据（增量同步）
全历史导入完成后，后面就不需要再从 2020 开始了，可以用 增量模式：
python scripts/market/market_discovery.py \  --db database/polymarket_indexer.db \  --incremental
--incremental 会自动：
优先从 sync_state 里读上一次成功同步时间 last_market_discovery_at
如果没有这条记录，则回退到 DB 中 MAX(created_at) 作为起点
只拉「这次时间点之后的新市场」
是否支持定时执行？（有）
是的，已经内置了定时参数：
--watch：循环守护模式，不停跑
--interval：两次同步之间的间隔秒数（默认 3600 秒 = 1 小时）
典型用法（每小时自动增量同步一次）：
python scripts/market/market_discovery.py \  --db database/polymarket_indexer.db \  --incremental \  --watch \  --interval 3600
进程会：
每次根据 DB 自动推断起点，只拉新增市场
运行完休眠 3600 秒，再跑下一轮
在 stderr 打日志，Ctrl+C 即可干净退出