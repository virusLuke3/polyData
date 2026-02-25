# Polymarket Indexer 数据库分析报告

**数据库路径**: `database/polymarket_indexer.db`  
**分析时间**: 2026-02-22  
**报告说明**: 基于当前 SQLite 文件的结构与数据统计生成。

---

## 1. 概览

| 项目 | 数值 |
|------|------|
| 数据库文件大小 | **665.34 MB** |
| 日志模式 | WAL (Write-Ahead Logging) |
| 表数量 | 4（markets, trades, sync_state, sqlite_sequence） |
| 总市场数 | **372,353** |
| 总交易数 | **0** |
| 同步状态键 | 1（closed_events_offset） |

---

## 2. 表结构

### 2.1 `markets` — 市场元数据

| 列名 | 类型 | 非空 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| slug | TEXT | ✓ | 唯一，市场短标识 |
| condition_id | TEXT | ✓ | 唯一，链上条件 ID |
| question_id | TEXT |  | 问题 ID |
| oracle | TEXT |  | 预言机地址 |
| yes_token_id | TEXT | ✓ | YES 结果代币 ID |
| no_token_id | TEXT | ✓ | NO 结果代币 ID |
| title | TEXT |  | 标题 |
| description | TEXT |  | 描述 |
| enable_neg_risk | INTEGER |  | 是否负风险市场（0/1） |
| end_date | TEXT |  | 结束时间 |
| created_at | TEXT |  | 创建时间（ISO） |
| category | TEXT |  | 分类 |
| tags | TEXT |  | 标签 |

**索引**:
- `idx_markets_condition_id` ON (condition_id)
- `idx_markets_yes_token` ON (yes_token_id)
- `idx_markets_no_token` ON (no_token_id)

### 2.2 `trades` — 交易记录

| 列名 | 类型 | 非空 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| tx_hash | TEXT | ✓ | 交易哈希 |
| log_index | INTEGER | ✓ | 日志索引 |
| market_id | INTEGER | ✓ | 关联 markets.id |
| maker | TEXT | ✓ | 挂单方 |
| taker | TEXT | ✓ | 吃单方 |
| price | TEXT | ✓ | 价格 |
| size | TEXT | ✓ | 数量 |
| side | TEXT | ✓ | BUY/SELL |
| outcome | TEXT |  | YES/NO |
| token_id | TEXT | ✓ | 头寸代币 ID |
| block_number | INTEGER |  | 区块号 |
| timestamp | TEXT |  | 区块时间 |
| created_at | TEXT |  | 写入时间 |

**约束**: UNIQUE(tx_hash, log_index), FOREIGN KEY (market_id) → markets(id)

**索引**:
- `idx_trades_market_id` ON (market_id)
- `idx_trades_timestamp` ON (timestamp)
- `idx_trades_block` ON (block_number)

### 2.3 `sync_state` — 同步进度

| 列名 | 类型 | 说明 |
|------|------|------|
| key | TEXT | PK，如 trade_sync、closed_events_offset |
| value | TEXT | 进度值 |
| last_block | INTEGER | 上次区块（可选） |
| updated_at | TEXT | 更新时间 |

---

## 3. 数据统计

### 3.1 markets

| 指标 | 数值 |
|------|------|
| 总行数 | **372,353** |
| ID 范围 | 1 ~ 372,353（连续） |
| created_at 范围 | **2024-09-01** ~ **2026-02-22** |
| 有 end_date | 370,563（约 99.5%） |
| end_date 范围 | 2024-09-01 ~ 2028-11-07 |
| 有 title | 372,353（100%） |
| 有 description | 372,353（100%） |
| 有 tags | 372,353（100%） |
| 有 oracle | 372,353（100%） |
| 有 question_id | 372,353（100%） |
| 有 category 非空 | 0（当前均为空字符串） |

**enable_neg_risk 分布**:

| enable_neg_risk | 数量 | 占比 |
|-----------------|------|------|
| 0（普通二元） | 258,262 | 69.4% |
| 1（负风险） | 114,091 | 30.6% |

**按日新增市场（最近 10 天）**:

| 日期 | 新增市场数 |
|------|------------|
| 2026-02-22 | 1,908 |
| 2026-02-21 | 3,965 |
| 2026-02-20 | 2,536 |
| 2026-02-19 | 2,762 |
| 2026-02-18 | 2,512 |
| 2026-02-17 | 2,433 |
| 2026-02-16 | 2,844 |
| 2026-02-15 | 3,856 |
| 2026-02-14 | 3,362 |
| 2026-02-13 | 2,978 |

**按日新增市场（最早 10 天）**:

| 日期 | 新增市场数 |
|------|------------|
| 2024-09-01 | 8 |
| 2024-09-02 | 27 |
| 2024-09-03 | 117 |
| 2024-09-04 | 79 |
| 2024-09-05 | 34 |
| 2024-09-06 | 90 |
| 2024-09-07 | 7 |
| 2024-09-08 | 26 |
| 2024-09-09 | 108 |
| 2024-09-10 | 36 |

### 3.2 trades

| 指标 | 数值 |
|------|------|
| 总行数 | **0** |

说明：当前库内尚未写入任何链上成交记录，需通过 `trades_indexer` 从指定区块范围拉取并写入。

### 3.3 sync_state

| key | value | last_block | updated_at |
|-----|-------|------------|------------|
| closed_events_offset | 0 | NULL | 2026-02-22T16:29:02.521584+00:00 |

说明：仅有「closed events」拉取进度；**无 trade_sync**，与 trades 表为空一致。

---

## 4. 数据质量与完整性

| 检查项 | 结果 |
|--------|------|
| markets.condition_id 唯一 | ✓ 无重复 |
| markets.slug 唯一 | ✓ 无重复 |
| trades 表可写入 | ✓ 表与索引存在，无数据 |
| sync_state 存在 | ✓ 1 条记录 |

**结论**:
- 市场表无重复 condition_id/slug，结构健康。
- 交易表为空，需运行 `scripts/trade/trades_indexer.py` 从链上同步。
- category 字段当前全部为空，若需分类统计可后续由 Gamma/CLOB 或业务逻辑回填。

---

## 5. 建议

1. **交易同步**  
   使用 `trades_indexer` 指定区块范围（或 `--continue-sync`）拉取 OrderFilled 并写入 `trades`，同步后 `sync_state` 中会出现 `trade_sync` 及对应 `last_block`。

2. **分类与标签**  
   `category` / `tags` 若需用于筛选或统计，可考虑在 market discovery 或单独任务中从 Gamma API 等来源写入。

3. **备份与维护**  
   库体积约 665 MB，建议定期备份；WAL 已开启，适合持续写入。可配合 `VACUUM`（在低峰期）控制文件大小。

4. **查询性能**  
   已对 condition_id、yes_token_id、no_token_id、market_id、timestamp、block_number 建索引，按市场、时间、区块查询可满足常规需求。

---

## 6. 附录：生成本报告所用查询摘要

- 表结构：`PRAGMA table_info(...)`、`sqlite_master`
- 行数：`SELECT COUNT(*) FROM ...`
- 时间范围：`MIN(created_at)`, `MAX(created_at)`，按 `date(created_at)` 分组统计
- 唯一性：`GROUP BY condition_id/slug HAVING COUNT(*) > 1`
- 文件大小：`os.path.getsize(...)`，journal_mode：`PRAGMA journal_mode`
