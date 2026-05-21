# market / oracle PostgreSQL 当前方案与维护手册

更新时间：2026-05-18

这份文档记录当前 `polyData` 的 **market / oracle 核心数据库方案**。旧版“迁移前规划”已经过时；当前状态是：market 与 oracle 数据已经迁入 PostgreSQL，后续维护应以 PostgreSQL 为准。

## 1. 当前结论

- `market` 和 `oracle` 继续使用 PostgreSQL，作为项目的关系型核心库。
- `OrderFilled / trades_v2` 不迁入 PostgreSQL，后续单独设计 ClickHouse。
- MySQL 只作为旧数据源、回滚源和临时交易库，不再作为 market/oracle 的目标架构。
- 新盘 `/data2/jiahuaiyu` 是后续数据库数据目录的目标位置：
  - PostgreSQL：`/data2/jiahuaiyu/postgres`
  - ClickHouse：`/data2/jiahuaiyu/clickhouse`

## 2. 当前数据库分层

```text
PostgreSQL poly_data_core
  core.markets
  core.market_tokens
  core.market_resolution_fast
  core.market_status_snapshot
  core.market_latest_prices
  core.market_list_serving
  core.market_chart_serving
  core.market_workspace_serving
  core.event_market_serving
  oracle.oracle_events
  oracle.uma_adapter_mapping
  oracle.neg_risk_request_mapping
  ops.sync_state

MySQL poly_data
  legacy market/oracle source
  trades_v2 and trade analytics interim source

ClickHouse
  future OrderFilled / trades_v2 raw facts
  future large-scale market/address/time analytics
```

PostgreSQL 连接默认由 `.env` 中的变量提供，代码通过 `scripts/db/db.py` 的统一 wrapper 连接。当前本机 PostgreSQL 服务地址：

```text
127.0.0.1:45432/poly_data_core
```

不要在文档或命令里写明文密码，统一从 `.env` 读取。

## 3. 当前 PostgreSQL 数据规模

2026-05-16 查询结果：

| 表 | 行数 |
| --- | ---: |
| `markets` | 1,081,950 |
| `market_tokens` | 110,757 |
| `market_resolution_fast` | 657,450 |
| `market_status_snapshot` | 883,245 |
| `oracle_events` | 2,307,529 |
| `uma_adapter_mapping` | 664,595 |
| `neg_risk_request_mapping` | 198,422 |

`oracle_events` 状态分布：

| event_status | 事件数 | market 数 |
| --- | ---: | ---: |
| `request` | 883,720 | 865,253 |
| `propose` | 605,266 | 592,743 |
| `dispute` | 2,849 | 2,397 |
| `settle` | 815,694 | 803,200 |

`market_status_snapshot` 历史结算结果分布：

| settlement_outcome | settlement_source | 数量 |
| --- | --- | ---: |
| `YES` | `oracle_settled_price` | 208,377 |
| `YES` | `oracle_payout` | 105,132 |
| `YES` | `market_resolution_fast` | 9,143 |
| `NO` | `oracle_settled_price` | 372,361 |
| `NO` | `oracle_payout` | 105,647 |
| `NO` | `market_resolution_fast` | 9,687 |
| `CANCELLED` | `oracle_settled_price` | 10,683 |
| `CANCELLED` | `market_resolution_fast` | 250 |
| `UNKNOWN` | `NULL` | 61,965 |

## 4. 核心表职责

### `core.markets`

market 权威档案表，保存本地 market 主键、Gamma 官方 id、slug、condition、question、oracle、YES/NO token 等字段。

关键口径：

- `markets.id` 是本地数据库主键。
- `markets.gamma_market_id` 才是 Gamma 官方 market id。
- 调用 Gamma `/markets/{id}` 或其他官方接口时，必须使用 `gamma_market_id`。
- 本地 join 使用 `markets.id`，例如 `oracle_events.market_id -> markets.id`。

### `core.market_tokens`

token 到 market 的标准映射，供 LOB、trades、orderfilled 解析使用。

注意：当前 `market_tokens` 数量小于 `markets`，它不是全量历史 market 的必然完整展开，而是后续 LOB / orderfilled 需要逐步补齐的 token 维表。

### `oracle.oracle_events`

oracle 生命周期事实表。当前统一承接：

- UMA request / propose / dispute / settle
- updown / CTF ConditionPreparation / ConditionResolution

它是事实表，不直接给前端查询所有状态。前端和 API 应优先读 `market_status_snapshot`。

### `core.market_resolution_fast`

来自 Gamma closed events 与补充复核逻辑的快速结算结果。这个表会保留 Gamma 的 `closed_time`，并在能明确判断时写入 `settlement_code`。

`settlement_code` 约定：

| code | outcome |
| ---: | --- |
| 0 | `UNKNOWN` |
| 1 | `YES` |
| 2 | `NO` |
| 3 | `CANCELLED` |

它不能替代 oracle 事实表，但可以补充部分没有标准 UMA settle 的市场。这里的 `closed` 表示 Gamma 层面不再交易或已关闭，不等价于链上 oracle 已最终 settle。

### `core.market_status_snapshot`

market 级别状态快照。当前升级为 v3 状态模型，同时保存“交易是否关闭”和“是否最终结算”两套口径。

核心字段：

```text
market_id
has_settle
has_propose
has_dispute
settlement_code
settlement_outcome
settlement_source
settlement_raw
settlement_event_id
settlement_event_time
settlement_transaction
is_trading_closed
is_resolved
is_final
completion_status
completion_source
completion_time
gamma_closed
gamma_closed_time
updated_at
```

生成逻辑：

```text
oracle_events.settled_price
oracle_events.payout
market_resolution_fast.settlement_code
market_resolution_fast.closed_time
markets.end_date
  -> scripts/oracle/settlement_parser.py
  -> market_status_snapshot
```

结算结果优先级：

1. oracle `settled_price`
2. oracle / CTF `payout`
3. `market_resolution_fast`
4. `UNKNOWN`

状态口径优先级：

1. oracle `settle`：链上最终状态，`is_final = true`。
2. oracle `dispute`：存在争议，`completion_status = DISPUTED`，还不是最终结算。
3. oracle `propose`：已提议结算，`completion_status = PROPOSED`，还不是最终结算。
4. Gamma closed / `market_resolution_fast.closed_time`：交易关闭或官方接口关闭，`is_trading_closed = true`，但不等价于 oracle final。
5. `markets.end_date` 已过：市场理论上结束交易，`completion_status = ENDED_AWAITING_ORACLE`，等待 oracle 事实确认。

`completion_status` 约定：

| status | 含义 |
| --- | --- |
| `OPEN` | 仍可交易或没有任何关闭证据 |
| `ENDED_AWAITING_ORACLE` | `markets.end_date` 已过，但还没有 oracle propose/settle |
| `PROPOSED` | oracle 已 propose，还没有最终 settle |
| `DISPUTED` | oracle 出现 dispute |
| `SETTLED` | oracle 已最终 settle，结果为 YES/NO |
| `CANCELLED` | oracle 或可信补充源确认取消 |
| `GAMMA_CLOSED_FALLBACK` | Gamma closed 且 fast resolution 给出结果，但缺少 oracle final |
| `CLOSED_UNRESOLVED` | Gamma closed，但还没有可靠结算结果 |
| `UNKNOWN` | 有 final 事件但 parser 无法归一化结果，需要人工复核 |

### `core.market_latest_prices` / `core.market_list_serving`

market panel 的轻量价格与活跃度 serving 层。它们由 `scripts/db/sync_trade_analytics.py` 从当前 trade/orderfilled 派生数据生成。

- `market_latest_prices` 保存最新 YES/NO 价格和最后成交位置。
- `market_list_serving` 保存 `latest_price / price_24h_ago / trade_count_24h / volume_24h / last_trade_at`。

API 的 `/markets` 和 `/markets/:id/price` 应优先读这两张表，只有缺失时才 fallback 到旧 trade 扫描或 runtime CLOB。

### `core.market_chart_serving`

单个 market 的概率走势 serving 表，避免前端点击 market 时现场扫 trade/orderfilled 或反复请求 CLOB history。

主键：

```text
(market_id, range_name, interval_name)
```

当前生成范围：

```text
1h / 6h / 1d / 1w / 7d / 1m / 30d / all
```

核心字段：

```text
kind
history_status
point_count
points JSONB
updated_at
```

生成脚本：

```bash
conda run -n polyBots python scripts/db/sync_market_workspace_serving.py \
  --backend postgres \
  --once \
  --max-markets 20000
```

这个脚本只读本地 PostgreSQL 现有数据，不抓 Gamma/CLOB/RPC，不应产生外部流量。

### `core.market_workspace_serving`

单个 market detail panel 的 bundle serving 表。它把 panel 首屏需要的 `detail_payload / price_payload / oracle_summary` 预先物化，API `/markets/:id/detail` 和 `/markets/:id/price` 优先按 `market_id` 主键读取。

这个表解决的问题是：

- 点击 market 不再同步拉 trades。
- detail 不再重复计算 chart。
- price 不再现场聚合 trade/orderfilled。
- oracle 状态先读 snapshot summary，timeline 仍由 `/markets/:id/oracle` 按需加载。

### `core.event_market_serving`

event-first / group-first 的 market panel serving 表。`/market-groups` 优先读这里，而不是每次现场把 `markets + market_list_serving + market_status_snapshot` 聚合成 event。

## 5. 结算解析规则

代码位置：

- `scripts/oracle/settlement_parser.py`
- `scripts/db/sync_trade_analytics.py`
- `scripts/market/sync_market_resolution_fast.py`

UMA 结算：

| `settled_price` | outcome |
| --- | --- |
| `1` 或 `1e18` | `YES` |
| `0` | `NO` |
| `0.5` | `CANCELLED` |

CTF / updown 结算：

| `payout` | outcome |
| --- | --- |
| `[1, 0]` | `YES` |
| `[0, 1]` | `NO` |
| `[1, 1]` | `CANCELLED` |

如果 oracle 与 fast resolution 冲突，当前规则优先使用 oracle。fast resolution 是补充来源，不是最高权威来源。

注意：`isTradingClosed` 只回答“这个 market 是否还应该作为可交易市场展示”；`isResolved` 回答“是否已有 YES/NO/CANCELLED 业务结果”；`isFinal` 回答“是否已经由 oracle settle 最终确认”。前端和 API 不要把这三个概念混在一起。

## 6. 常用维护命令

### 6.1 只迁 market

```bash
conda run -n polyBots python migrate_mysql_to_postgres.py \
  --tables market \
  --create-schema \
  --verify \
  --yes
```

### 6.2 只迁 oracle

```bash
conda run -n polyBots python migrate_oracle_mysql_to_postgres.py \
  --tables oracle \
  --create-schema \
  --verify \
  --yes
```

### 6.3 重建 market 状态快照

这个命令不重新抓链，也不复制 oracle 明细，只用现有 PostgreSQL 数据重新生成 `market_status_snapshot`。

```bash
conda run -n polyBots python scripts/db/sync_trade_analytics.py \
  --backend postgres \
  --market-only \
  --max-batches 0
```

当前快照同步 key：

```text
market_status_snapshot_sync_v3
```

使用 v3 key 的原因：v2 只代表 `YES/NO/CANCELLED` parser 已经重建过，不代表新增的 `completion_status / is_trading_closed / is_final / gamma_closed_time` 字段已经按新规则重建过。第一次部署 v3 后应跑一次全量快照重建。

### 6.4 验证快照

```sql
SELECT COUNT(*) FROM market_status_snapshot;

SELECT settlement_outcome, settlement_source, COUNT(*)
FROM market_status_snapshot
GROUP BY settlement_outcome, settlement_source
ORDER BY settlement_outcome, settlement_source;

SELECT value, last_block
FROM sync_state
WHERE "key" = 'market_status_snapshot_sync_v3';
```

### 6.5 重建 market workspace serving

这个命令不访问外部网络，只用现有 PostgreSQL 表生成单 market panel 的价格、chart 和 detail bundle serving。

```bash
conda run -n polyBots python scripts/db/sync_market_workspace_serving.py \
  --backend postgres \
  --once \
  --max-markets 20000
```

小范围验证指定 market：

```bash
conda run -n polyBots python scripts/db/sync_market_workspace_serving.py \
  --backend postgres \
  --once \
  --market-id 1725357
```

## 7. API 与前端读取原则

market 列表、详情、oracle timeline 应遵守：

- market 基础身份读 `markets`
- oracle timeline 读 `oracle_events`
- 当前状态与业务结算读 `market_status_snapshot`
- 快速结算补充读 `market_resolution_fast`
- market 列表和价格优先读 `market_list_serving / market_latest_prices`
- 单 market chart 优先读 `market_chart_serving`
- 单 market detail bundle 优先读 `market_workspace_serving`
- 最新价格、成交统计在 ClickHouse 迁移前由 PostgreSQL serving 表承接；原始大规模 OrderFilled 后续再迁 ClickHouse

API 已开始输出：

```text
settlementCode
settlementOutcome
settlementSource
settlementEventId
settlementEventTime
settlementTransaction
completionStatus
completionSource
completionTime
isTradingClosed
isResolved
isFinal
gammaClosed
gammaClosedTime
```

前端不要自己解析 `settled_price` 或 `payout`，应直接消费 `settlementOutcome` 和 `completionStatus`。列表页判断 Active/Closed 时优先使用 `isTradingClosed`；详情页展示结算结果时优先使用 `isFinal + settlementOutcome`。

## 8. 哪些旧表或旧概念不再作为正式方案

以下内容不要作为新的核心方案继续扩展：

- 把 `OrderFilled / trades_v2` 放进 PostgreSQL
- 让 `market_status_snapshot` 只保存 `has_settle/has_propose`
- 把 Gamma `closed` 当成 oracle `settled`
- 让前端或 API 每次现场扫 `oracle_events` 判断状态
- 让前端或 API 每次点击 market 都现场扫 trade/orderfilled 生成 chart
- 继续把 `markets.id` 当成 Gamma 官方 id
- 把 `market_resolution_current` / `market_resolution_history` 提升为正式 schema，除非先补稳定维护脚本
- 在文档或命令里写明文 MySQL/PostgreSQL 密码

## 9. 后续任务

1. 把 `market_status_snapshot` 从 `sync_trade_analytics.py` 中进一步拆成独立 `sync_market_status_snapshot.py`。
2. 给 oracle adapter 管理事件补充解析，例如 `QuestionReset`、`QuestionManuallyResolved`、`QuestionEmergencyResolved`。
3. 为 `OrderFilled / trades_v2` 设计 ClickHouse 方案。
4. 将交易统计派生表从 MySQL 迁出，长期由 ClickHouse 重新生成。
5. 对 API 做完整 PostgreSQL shadow diff，确认 market/oracle payload 长期稳定。
