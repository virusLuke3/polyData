# polyData

polyData 是一个围绕 Polymarket 数据构建的索引与分析仓库，核心目标是把市场、交易、预言机事件和同步断点整理成可查询的结构化数据。

本文档只说明仓库中的数据组成、表结构和样例数据含义，不包含任何具体数据库连接信息。

## 仪表盘启动

- 本地 API 辅助启动：`bash scripts/start_dashboard.sh`
- 前端开发：`cd webpage && npm run dev`
- API 默认地址：`http://127.0.0.1:18500`
- Web 默认地址：`http://127.0.0.1:3000`
- 本机生产常驻服务建议使用 `deploy/systemd/` 模板

## 仓库中的数据目录

- `database/markets.json`: 市场样例数据，展示 market 元信息长什么样。
- `database/closed_markets.json`: 已结束或已关闭市场样例。
- `database/trades_sample.json`: 交易样例，展示链上成交记录如何被整理。
- `database/oracle.json`: Oracle 事件样例，展示市场结算与提案事件如何落库。
- `database/POLYMARKET_INDEXER_DB_REPORT.md`: 历史数据库分析报告，主要用于理解早期结构演化。

## 当前数据库组成

当前工程围绕 6 张核心表组织数据：

### 1. markets

存放市场主数据，每一行代表一个 Polymarket 市场。

常见字段：

| 字段 | 含义 |
| --- | --- |
| id | 内部主键 |
| gamma_market_id | 外部市场 ID |
| slug | 市场短标识 |
| condition_id | 链上 condition 标识 |
| question_id | 链上 question 标识 |
| oracle | 对应预言机或 adapter 地址 |
| yes_token_id | YES 头寸 token id |
| no_token_id | NO 头寸 token id |
| title | 市场标题 |
| description | 市场描述 |
| enable_neg_risk | 是否属于 neg risk 结构 |
| end_date | 市场结束时间 |
| created_at | 市场创建时间 |
| category | 分类 |
| tags | 标签信息 |
| clob_token_ids | CLOB token id 列表 |

这一层是全仓库的主索引。trade 和 oracle_event 最终都会通过 `market_id` 或 `condition_id` 回到这里。

### 2. trades

存放链上撮合成交记录，每一行对应一条 OrderFilled 类事件的解析结果。

常见字段：

| 字段 | 含义 |
| --- | --- |
| id | 内部主键 |
| tx_hash | 交易哈希 |
| log_index | 日志序号，同一交易内唯一 |
| market_id | 关联的市场主键 |
| maker | 挂单方地址 |
| taker | 吃单方地址 |
| price | 成交价格 |
| size | 成交数量 |
| side | 买卖方向，通常为 BUY 或 SELL |
| outcome | 对应 YES 或 NO 头寸 |
| token_id | 本次交易涉及的 outcome token |
| block_number | 区块高度 |
| timestamp | 区块时间 |
| order_hash | 订单哈希 |
| maker_asset_id | maker 资产 id |
| taker_asset_id | taker 资产 id |
| maker_amount | maker 成交量 |
| taker_amount | taker 成交量 |
| fee | 手续费 |
| contract | 触发成交的合约 |
| created_at | 数据写入时间 |

这张表是做成交分析、价格回放、用户行为分析的核心来源。

### 3. oracle_events

存放 Oracle 侧的请求、提案、争议、结算等事件，是市场结果层的证据链。

常见字段：

| 字段 | 含义 |
| --- | --- |
| id | 内部主键 |
| tx_hash | 交易哈希 |
| log_index | 日志序号 |
| block_number | 区块高度 |
| event_time | 事件时间 |
| event_status | 事件状态，如 request、propose、dispute、settle |
| external_market_id | 外部市场 ID |
| market_id | 关联市场主键 |
| market_title | 关联市场标题 |
| source_adapter | 来源 adapter |
| source_oracle | 来源 oracle |
| adapter_question_id | adapter 侧 question id |
| matched_by | 市场匹配方式 |
| question_id | question id |
| condition_id | condition id |
| string_raw | 原始 ancillary / 问题文本 |
| p1 / p2 | 预定义结果槽 |
| proposed_price | 提案价格 |
| settled_price | 最终结算价格 |
| settlement_recipient | 结算接收方 |
| payout | payout 信息 |
| requester | 请求方 |
| proposer | 提议方 |
| disputer | 争议方 |
| request_transaction | 请求交易 |
| proposal_transaction | 提案交易 |
| settlement_transaction | 结算交易 |
| created_at | 数据写入时间 |

这张表解决的是“这个市场最后怎么结算、结算依据是什么”的问题。

### 4. sync_state

存放各条同步链的断点信息。

常见字段：

| 字段 | 含义 |
| --- | --- |
| key | 断点名称 |
| value | 断点值 |
| last_block | 最近确认完成的区块 |
| updated_at | 更新时间 |

当前常见断点键：

- `market_sync`: 常规市场增量同步
- `market_sync_live`: live 模式市场同步
- `trade_sync`: 历史 trade 回填
- `trade_sync_live`: live 模式 trade 同步
- `oracle_sync`: 历史 oracle 回填
- `oracle_sync_live`: live 模式 oracle 同步

### 5. block_timestamps

缓存区块时间，避免重复请求链上 block metadata。

常见字段：

| 字段 | 含义 |
| --- | --- |
| block_number | 区块高度 |
| timestamp | 区块时间 |
| created_at | 写入时间 |

### 6. uma_adapter_mapping

维护 UMA adapter ancillary data 到 question_id 的映射，用于 Oracle 事件与市场的桥接。

常见字段：

| 字段 | 含义 |
| --- | --- |
| ancillary_data | 原始 ancillary data |
| question_id | 对应的链上 question id |

## 数据之间的关系

可以把这套数据理解成一条从市场创建到结果结算的链路：

1. `markets` 定义市场本身是谁。
2. `trades` 记录这个市场发生过哪些成交。
3. `oracle_events` 记录这个市场如何进入结算、由谁提案、最终结算到什么价格。
4. `sync_state` 记录各条同步任务处理到了哪里。
5. `block_timestamps` 为交易和事件补齐时间维度。
6. `uma_adapter_mapping` 负责把 Oracle 文本问题映射回链上 question_id。

## 一组真实串联数据

除了 `database/` 目录中的 JSON 样例，下面再给一组直接取自当前数据库的真实记录，用来说明 `markets`、`trades`、`oracle_events` 是如何串起来的。

### 真实 market 记录

这个市场的标题是 `Will Ipswich Town FC win on 2026-03-10?`，内部 `market_id = 32717`。

```json
{
  "id": 32717,
  "gamma_market_id": null,
  "slug": "elc-sto-ips-2026-03-10-ips",
  "title": "Will Ipswich Town FC win on 2026-03-10?",
  "condition_id": "0x5edab7f543030a0738fe867788ed4d639100b4bf5555c47707789dff5d7ed92f",
  "question_id": "0xf797b92813b7f3f5a387ce01f285cae646034f8d5f25282a2f76b20bcb87f802",
  "oracle": "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d",
  "yes_token_id": "45676632512669433437950569702332421946821963255462411722510513641989757985176",
  "no_token_id": "21857585696321253453688626605352029010472273140361020119787318198411384215913",
  "end_date": "2026-03-10T20:00:00Z",
  "created_at": "2026-02-11T05:00:17.500717Z",
  "enable_neg_risk": 1
}
```

这个记录说明：市场在链上是通过 `condition_id` 和 `question_id` 识别的，同时有一对 YES/NO token，后续交易和 oracle 事件都能通过这些字段回到同一个市场。

### 这一个市场的一笔真实 trade

下面是一笔属于该市场的真实成交。为了把链路写完整，这里将数据库中的 trade 记录与同一笔链上原始日志的重解码结果合并展示，所以除了 `market_id`、`timestamp`、`outcome` 这些索引字段外，也补上了 `order_hash`、`maker_asset_id`、`taker_asset_id`、`maker_amount`、`taker_amount`、`fee`、`contract`：

```json
{
  "tx_hash": "399798e9cdf915d02e1ba48757c10f94a946dc50aa96d3e2740a93ff921e963a",
  "log_index": 1552,
  "block_number": 83972684,
  "timestamp": "2026-03-09T14:10:01Z",
  "maker": "0x16fe74b8E9BA17F5d7F2d7b472D7590dDEE49496",
  "taker": "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  "price": "0.529999",
  "size": "47.16981",
  "side": "BUY",
  "token_id": "45676632512669433437950569702332421946821963255462411722510513641989757985176",
  "order_hash": "c6083dd854631d692ff48976317429034ddebd770af991b693c38585a2d4dbde",
  "maker_asset_id": "0",
  "taker_asset_id": "45676632512669433437950569702332421946821963255462411722510513641989757985176",
  "maker_amount": "24999999",
  "taker_amount": "47169810",
  "fee": "0",
  "contract": "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  "market_id": 32717,
  "outcome": "YES"
}
```

这里最关键的是两点：

- `market_id = 32717`，直接把这笔交易挂到上面的市场记录上。
- `token_id` 等于该市场的 `yes_token_id`，所以这笔成交对应的是 YES 头寸。

同时，这些扩展字段还能帮助解释这笔成交本身：

- `order_hash` 是该笔撮合对应的订单标识。
- `maker_asset_id = 0` 表示 maker 支付的是抵押品。
- `taker_asset_id` 等于 YES token，因此这笔记录对应买入 YES。
- `maker_amount = 24999999` 与 `taker_amount = 47169810` 对应了这笔成交的价格和数量。
- `fee = 0` 表示这条成交记录中未产生额外手续费。
- `contract` 指向实际发生撮合的 NegRisk 交易所合约地址。

### 对应的真实 oracle propose / settle 记录

同一个市场在 oracle 侧也有完整的提案和结算记录。

提案记录：

```json
{
  "event_status": "propose",
  "block_number": 84029877,
  "event_time": "2026-03-10 21:56:27.000 UTC",
  "tx_hash": "0xa85a5b6403fef0d28e0a6b39d2b43a17de266adb8671b125c70a824611747888",
  "external_market_id": "1364781",
  "market_id": 32717,
  "market_title": "Will Ipswich Town FC win on 2026-03-10?",
  "matched_by": "by_title",
  "question_id": "0xf797b92813b7f3f5a387ce01f285cae646034f8d5f25282a2f76b20bcb87f802",
  "condition_id": "0x5edab7f543030a0738fe867788ed4d639100b4bf5555c47707789dff5d7ed92f",
  "proposed_price": "0.0",
  "requester": "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d",
  "proposer": "0x9c1f9b97cd995a9c0cf0ffe20f4d2f5e9c830c09"
}
```

结算记录：

```json
{
  "event_status": "settle",
  "block_number": 84034064,
  "event_time": "2026-03-11 00:16:01.000 UTC",
  "tx_hash": "0x15d54f0e016a8f7941640f4dbfba4ee94720d637bf5ccf81bae90794385e59a6",
  "external_market_id": "1364781",
  "market_id": 32717,
  "market_title": "Will Ipswich Town FC win on 2026-03-10?",
  "matched_by": "by_title",
  "question_id": "0xf797b92813b7f3f5a387ce01f285cae646034f8d5f25282a2f76b20bcb87f802",
  "condition_id": "0x5edab7f543030a0738fe867788ed4d639100b4bf5555c47707789dff5d7ed92f",
  "settled_price": "0.0",
  "requester": "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d",
  "proposer": "0x9c1f9b97cd995a9c0cf0ffe20f4d2f5e9c830c09",
  "disputer": "0x0000000000000000000000000000000000000000"
}
```

这两条 oracle 记录和上面的 market / trade 是同一条链：

- `market_id` 一致，都是 `32717`
- `question_id` 一致
- `condition_id` 一致

因此这组真实数据可以完整展示一个市场从交易到结果确认的过程：

1. 先在 `markets` 中定义市场。
2. 在 `trades` 中出现该市场的 YES/NO 成交。
3. 在 `oracle_events` 中看到该市场的结果被提案并最终结算。
4. 本例中 `settled_price = 0.0`，表示这个市场最终按 `No` 方向结算。

## 样例数据说明

### 市场样例

文件: `database/markets.json`

单条样例大致如下：

```json
{
  "slug": "will-oviedo-win-the-202526-la-liga",
  "condition_id": "0x909bcd8ae00d0cd47b561a40d655ae4b71f24df00e7d82b18874698046f61f0e",
  "question_id": "0x785d28da53545dcc8fa118d79f60eb3c9c77afc48288902e4005ad1fdb888a13",
  "oracle": "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d",
  "collateral_token": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "yes_token_id": "101034781667138250733136802399214749887004559624140030974637434747957754961459",
  "no_token_id": "98821418240180308359053690992711194531557606257448260576977615323823386236068",
  "title": "Will Oviedo win the 2025–26 La Liga?",
  "status": "active",
  "enable_neg_risk": 1,
  "end_date": "2026-05-30T00:00:00Z",
  "created_at": "2025-07-21T21:26:47.615236Z"
}
```

这类记录表达的是：一个市场的链上标识、两个头寸 token、标题、状态和时间信息。

### 已关闭市场样例

文件: `database/closed_markets.json`

这类样例和 `markets.json` 字段相近，但更适合观察已经结束的市场，比如美国大选类市场。它通常用于：

- 分析历史市场生命周期
- 验证市场关闭后的标题、描述和时间字段
- 对照 Oracle 结算结果做复盘

### 交易样例

文件: `database/trades_sample.json`

该文件除了样例交易外，还包含一个区块范围摘要：

```json
{
  "block_range": [74000000, 74001000],
  "summary": {
    "processed": 7503,
    "trades_with_market": 7503
  }
}
```

单条交易样例如下：

```json
{
  "tx_hash": "16242650b3785ebac3979366e5605fdee15c172de76fc3e85c030ac718215b99",
  "log_index": 1331,
  "block_number": 74000001,
  "timestamp": "2025-07-15T19:00:28Z",
  "maker": "0x1e524Ff2123d380a690dBDF2245De2a9428E91d6",
  "taker": "0xad89f899f1524533adfD1e6A07DA692Fcd92f6E1",
  "price": "0.450000",
  "size": "50.06",
  "side": "SELL",
  "token_id": "15398595315308132942093963095858507834679196409989368744925419755838390450849",
  "market_id": 307411,
  "market_slug": "will-trump-say-million-billion-or-trillion-15-times-during-the-energy-and-innovation-summit-on-july-15",
  "outcome": "YES"
}
```

这类记录表达的是：哪一笔链上交易、在哪个区块、以什么价格和数量成交、对应哪个市场、成交的是 YES 还是 NO。

### Oracle 事件样例

文件: `database/oracle.json`

单条样例如下：

```json
{
  "block_number": 82737479,
  "event_time": "2026-02-08 23:56:21.000 UTC",
  "tx_hash": "0x20c24989e3966365a50494b02197e58b68239e7de7006951f7fa143d82a14197",
  "event_status": "settle",
  "external_market_id": "1269763",
  "market_id": 78779,
  "market_title": "Will Juventus FC vs. SS Lazio end in a draw?",
  "matched_by": "by_title",
  "question_id": "0x1024b1d9b2e4bc867028fbacab36e7e6a94e532d5952b888b2bc420556c09b01",
  "condition_id": "0x1f419455d62d3a675264588ccd8a04fa978b9baacd38de752e4fd74aa7d96080",
  "settled_price": "1.0",
  "requester": "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d",
  "proposer": "0x53692dbf47fce6fb3d54fded6a4834be981f557c",
  "settlement_transaction": "0x20c24989e3966365a50494b02197e58b68239e7de7006951f7fa143d82a14197"
}
```

这类记录表达的是：某个市场在 Oracle 流程中发生了什么，最终是按什么价格结算、由谁发起和确认。

## 如何使用这些样例

如果你想快速理解仓库数据，建议按这个顺序阅读：

1. 先看 `database/markets.json`，理解市场主键和 token id。
2. 再看 `database/trades_sample.json`，理解 token 如何映射到真实成交。
3. 再看 `database/oracle.json`，理解市场最后如何结算。
4. 最后结合 `sync_state` 的概念，理解数据同步为什么能断点续跑。

## 相关目录

- `scripts/market/`: 市场发现与市场参数处理
- `scripts/trade/`: 交易抓取、解码与写入
- `scripts/oracle/`: Oracle 事件抓取、匹配与结算数据整理
- `scripts/sync/`: 多链路统一同步
- `scripts/db/`: 数据库抽象层、迁移与校验脚本
- `document/`: 更详细的原理说明和阶段性文档

如果只关心“库里到底有什么数据”，阅读本 README 加上 `database/` 目录中的 4 个 JSON 样例文件就足够了。
