# 阶段一：Polymarket架构与链上数据解码

## 学习目标

- 了解 Polymarket 的核心数据模型，包括事件 (Event)、市场 (Market)、条件 (Condition)、集合 (Collection)、头寸 (Position 或 TokenId)，并能用自己的话解释它们之间的关系。
- 理解 Polymarket 链上日志在"市场创建 → 交易 → 结算"全过程中的作用，以及不同日志之间如何串联形成证据链。
- 掌握链上日志解析的方法，能够实现：
  - **交易解码 (Trade Decoder)**：给定交易哈希，解析链上交易日志，还原交易详情（价格、数量、方向等）。
  - **市场解码 (Market Decoder)**：给定市场的 `conditionId` 或创建日志，还原该市场的链上参数（问题描述对应的标识、预言机地址、质押品、Yes/No 头寸 TokenId 等）。

---

## 核心概念

### 事件 (Event) 与市场 (Market)

在 Polymarket 中，**事件**代表一个预测主题，例如"某次美联储利率决议"。一个事件下可以包含一个或多个市场。每个市场对应该事件下的一个具体预测问题。例如，对于事件"2024年美国大选"可以有多个市场："候选人 A 当选总统？"、"候选人 B 当选总统？"等，每个市场通常是一个二元预测（Yes/No）。

- **Market（市场）**：对应具体的 Yes/No 问题，是交易发生的基本单位。一些事件只有一个市场（例如简单的二元事件），而有些事件包含多个市场形成一个多结果事件。后者通常采用 Polymarket 的"负风险 (NegativeRisk)"机制来提高资金效率（见下文）。

- **NegativeRisk（负风险）**：当一个事件包含多个互斥市场（即"赢家通吃"的多选一事件）时，Polymarket 引入 `NegRiskAdapter` 合约，将这些市场关联起来，提高流动性利用率。具体来说，在同一事件下，一个市场的 NO 头寸可以转换为该事件中所有其他市场的 YES 头寸。这意味着持有任意一个结果的反向（NO）仓位，相当于持有对其他所有可能结果的正向（YES）头寸。通过这种机制，参与者不需要为每个可能结果都分别提供独立的资金，从而提高资本效率。`NegRiskAdapter` 合约提供了 `convert` 功能，实现 NO → YES 的头寸转换。

**示例**：假设事件是"谁将赢得选举？"，包含 5 个候选人作为 5 个市场（每个市场问"候选人 X 会赢吗？"）。在负风险架构下：

- YES 代币表示下注某候选人获胜；NO 代币表示下注该候选人不赢。
- 如果最终候选人 A 赢了，那么持有 A 市场 YES 代币的人可以兑回 1 USDC；持有其他所有候选人市场 NO 代币的人也可以各兑回 1 USDC（因为那些候选人没赢）。相反，持有 A 的 NO 代币、以及其他候选人的 YES 代币都变得一文不值。
- 通过 `NegRiskAdapter`，可以将对某候选人的 NO 头寸随时转换为对其他所有候选人的 YES 头寸持有。这体现了所有候选人"不赢"的头寸和其他候选人"赢"的头寸是等价的，从而联通了各市场的流动性。

### 条件 (Condition)、问题 (Question)、集合 (Collection) 与头寸 (Position/TokenId)

Polymarket 使用 Gnosis 开发的**条件代币框架 (Conditional Token Framework, CTF)** 来实现预测市场的头寸代币化。在该框架下：

#### Condition（条件）

每个市场在链上的"登记身份"。创建市场时，会调用 CTF 合约的 `prepareCondition` 方法注册一个条件。`ConditionId` 是通过哈希计算得出的唯一标识：

```
conditionId = keccak256(oracle, questionId, outcomeSlotCount)
```

其中：
- `oracle` 是预言机合约地址（Polymarket 目前使用 UMA Optimistic Oracle 作为预言机）。
- `questionId` 是问题的标识符（通常由问题内容等信息哈希得到，或 UMA Oracle 的 ancillary data 哈希）。
- `outcomeSlotCount` 是结果选项数量。对于二元市场，该值为 2。

Condition 就像市场的问题在链上的"出生证明"，绑定了唯一的问题 ID 和预言机。当市场需要结算时，预言机会针对这个 `conditionId` 发布结果。

#### Position（头寸）

头寸指的是用户持有的某市场某结果的份额（又称 Outcome Share）。Polymarket 将每个头寸实现为一个 ERC-1155 标准的可交易代币（又称 PositionId 或 TokenId）。每种结果对应一个不同的 TokenId，用于区分 YES 和 NO 两种头寸。

#### CollectionId（集合 ID）

在条件代币框架中，中间引入了集合的概念，用于表示特定条件下某个结果集合。计算方法为：

```
collectionId = keccak256(parentCollectionId, conditionId, indexSet)
```

其中：
- `parentCollectionId` 对于独立的条件通常为 `bytes32(0)`（Polymarket 所有市场都是独立条件，没有嵌套条件，因此 `parentCollectionId` 一律为 0）。
- `indexSet` 是一个二进制位掩码，表示选取哪些结果槽位。对于二元市场，有两个可能的 indexSet：
  - YES 头寸的 `indexSet = 1` (`0b01`，表示选取第一个结果槽)。
  - NO 头寸的 `indexSet = 2` (`0b10`，表示选取第二个结果槽)。

#### TokenId（PositionId）

最后，用抵押品代币地址和集合 ID 一起计算得到 ERC-1155 的 Token ID：

```
tokenId = keccak256(collateralToken, collectionId)
```

在 Polymarket 中，对于每个条件(市场)，会产生两个 TokenId —— 一个对应 YES 份额，一个对应 NO 份额。这两个 TokenId 是在该市场上交易的标的资产，代表了对同一预测问题的两种相反结果的头寸。

#### Collateral（抵押品）

Polymarket 市场的押注资金均以稳定币 USDC (Polygon 上为 USDC.e，地址 `0x2791...Aa84174`) 作为抵押品。每份 Outcome Token 背后对应 1 USDC 的抵押，当市场结算时兑现。

**价格含义**：比如价格 0.60 USDC 意味着花 0.60 USDC 可购买该市场 1 份 YES 代币。如果该结果最终发生，持有者可赎回 1 USDC（获得净盈利 0.40 USDC）；如果未发生，则该代币价值归零，损失全部本金 0.60 USDC。因此，二元期权代币价格可以理解为市场对该事件发生概率的定价。

---

## 市场的完整生命周期与链上证据链

Polymarket 的市场从创建到结算，关键的链上步骤和日志事件如下：

### 1. 市场创建 (Creation) – 登记问题

由市场创建者调用 `ConditionalTokens.prepareCondition` 创建条件。

**关键日志**：`ConditionPreparation` 事件，包含 `conditionId`、`oracle`、`questionId`、`outcomeSlotCount` 等信息。这个事件在链上确认了某预言机地址与问题 ID 的绑定关系，相当于市场的建立。一旦发布，预言机（UMA OptimisticOracle）稍后将根据这个 `conditionId` 报告结果。

### 2. 初始流动性提供与拆分 (Split) – 生成初始头寸代币

市场创建后，需要流动性提供者拆分出初始的 YES/NO 代币。通常通过调用 `ConditionalTokens.splitPosition` 将抵押品 USDC 拆分成等价值的 YES 和 NO 头寸。

**关键日志**：`PositionSplit` 事件，包含 `conditionId`、`collateralToken`（应为 USDC 地址）、`parentCollectionId`（一般为 0）、`partition`（拆分出的 indexSets 列表，如 `[1,2]`）、以及 `amount`（拆分抵押品数量）。该事件证明抵押品被锁定，并生成了对应数量的 YES 和 NO 代币。对于二元市场，拆分 1 USDC 通常会得到面值各 1 USDC 的 YES 和 NO 代币各一枚。最初的流动性提供者可能是做市商，他们将 USDC 拆分为两种头寸代币，并可以在订单簿上挂单提供买卖报价。

### 3. 交易 (Trading) – 撮合买卖订单

交易在 Polymarket 的链上撮合引擎（CLOB 合约）中进行。Polymarket 采用中心限价订单簿模型，订单撮合通过智能合约（对于普通二元市场是 CTF Exchange，多结果市场则通过 NegRisk_CTFExchange）完成。每笔撮合成交在链上记录交易日志：

**关键日志**：`OrderFilled` 事件。每当买卖双方的订单在链上部分或全部成交时，都会触发该事件，记录交易的详情，包括：

- `maker` 和 `taker` 地址：做市（挂单）方和吃单方地址。
- `makerAssetId` 和 `takerAssetId`：成交时双方各自支付的资产 ID（Polymarket 将资产用一个 ID 表示：0 表示 USDC，非零则表示特定市场的头寸 TokenId）。
- `makerAmountFilled` 和 `takerAmountFilled`：各方成交的数量（对应各自资产的数量，整数形式）。
- `fee`：maker 方支付的手续费数量。

因 Polymarket 交易总是发生在 USDC 和某个 Outcome Token 之间，所以一个 `OrderFilled` 事件里必然有一个资产是 USDC（资产 ID 为 0），另一个资产是某市场的 TokenId。例如，若 `makerAssetId = 0` 且 `takerAssetId` 为某 TokenId，则表示挂单方卖出 USDC、买入了该 TokenId（即挂单方下的是买入该头寸的订单）。相应地，成交价可以通过 `makerAmountFilled` 和 `takerAmountFilled` 计算得出（需结合资产的精度，详见下文"交易日志解码"部分）。在订单完全撮合时，通常还会伴随一个 `OrdersMatched` 事件，它将多个 `OrderFilled` 事件归组表示一次撮合完成，但初学分析时可以主要关注 `OrderFilled` 日志。

**重要细节（避免重复计数）**：同一笔撮合在链上可能产生多条 `OrderFilled`。通常会有“每个 maker 一条”的 `OrderFilled`，以及一条“taker 汇总”的 `OrderFilled`，其中 `taker` 字段会显示为 Exchange 合约地址本身。若直接按 `OrderFilled` 条数统计成交笔数或成交量，会出现**双计**。实践中可选择以下方式之一避免重复：
- 过滤掉 `taker == exchange_address` 的 `OrderFilled`（保留 maker 侧填单）。
- 或改用 `OrdersMatched` 作为“一次撮合”的唯一汇总记录。

值得注意的是，在 Polymarket 内部，真正的代币铸造和销毁与交易匹配是紧密相关的。当两个相反方向的订单成交且共同投入的 USDC 满足 1:1 配比时，会触发抵押品锁定和头寸代币铸造的过程。例如：

- 如果一名买家愿意以 0.70 USDC 价格买入 YES，另一名卖家（或另一买单的对手）愿意以 0.30 USDC 价格买入 NO，两人的意向可匹配为一笔交易：总共 1.00 USDC 被锁定，铸造出 1 个 YES 和 1 个 NO 代币，分别分配给出价 0.70 的买家和出价 0.30 的买家。这对应链上 `PositionSplit` 事件记录了 1 USDC 拆分出一对头寸，以及后续的 `OrderFilled` 记录了双方各得到代币和支出 USDC 的情况。
- 类似地，如果一方想卖出 YES 代币，另一方想卖出相同市场的 NO 代币，两笔 sell 单可以匹配成一个"合并"操作：这两枚 YES 和 NO 代币被同时销毁并赎回总计 1 USDC 给卖出方（各得相应报价的 USDC）。这种情况下会出现 `PositionsMerge` 和 `OrderFilled` 等日志，表示头寸被合并赎回。这是 Polymarket 允许无需等待事件结算就能退出仓位的一种机制。

### 4. 结算 (Resolution) – 确定结果并清算

当事件结果揭晓且到达市场设定的关闭时间后，预言机合约（例如 UMA OptimisticOracle）将把结果提交回 CTF 合约，调用 `reportPayouts(conditionId, payouts[])` 来公布各结果的兑付率。

**结果日志**：调用 `reportPayouts` 本身通常不会有特殊事件（或有 `ConditionResolution` 事件），但其效果是将相应 `conditionId` 下的头寸标记为可赎回：胜出的头寸代币每份价值 1 USDC，失败的头寸代币价值 0。用户随后可以调用 `ConditionalTokens.redeemPositions` 来赎回胜出代币的抵押品。Polymarket 当前使用 UMA 的乐观预言机机制，这意味着通常在预言机确认结果后，通过 Polymarket 前端或合约即可触发结算。结算完成后，对应的 YES/NO 代币可以兑换回 USDC，市场生命周期结束。

以上链上事件共同构成了市场的**证据链**：从 `ConditionPreparation` 证明市场的存在和参数、`PositionSplit` 证明资金注入和代币铸造、`OrderFilled` 记录交易交换细节、直到 `reportPayouts` 确认结果以供赎回。这些事件串联起来，可以让我们基于链上数据重建出市场发生的一切。

---

## 任务 A：交易日志解码 (Trade Decoder)

### 问题描述

实现一个通用的交易日志解析器，输入交易哈希（在 Polygon 链上），输出该交易中 Polymarket 订单撮合的详情。例如给定样本交易哈希 `0x916cad...9946`（假设其中包含一个 `OrderFilled` 事件），需要解析得到如下 JSON 结构：

```json
{
  "txHash": "0x916cad...9946",
  "logIndex": 123,
  "exchange": "0xC5d5...f80a",
  "maker": "0x....",
  "taker": "0x....",
  "makerAssetId": "12345...",
  "takerAssetId": "67890...",
  "makerAmountFilled": "1000000",
  "takerAmountFilled": "500000",
  "price": "0.5",
  "tokenId": "67890...",
  "side": "BUY"
}
```

字段说明：
- `exchange`: 撮合发生的交易所合约地址
- `maker`: 挂单方地址
- `taker`: 吃单方地址
- `makerAssetId`: maker 给出的资产 ID
- `takerAssetId`: taker 给出的资产 ID
- `makerAmountFilled`: maker 支付的资产数量（整数，可能需要转化单位）
- `takerAmountFilled`: taker 支付的资产数量
- `price`: 成交价格（计算得到，单位 USDC，例如 0.5 表示每份头寸 0.5 USDC）
- `tokenId`: 本次交易涉及的 OutcomeToken 的 ID（非 USDC 的资产 ID）
- `side`: 表示这笔交易对该 OutcomeToken 来说是买单成交（BUY）还是卖单成交（SELL）

### 解析思路

#### 1. 获取交易日志

通过 Polygon RPC（如 `eth_getTransactionReceipt`）获取指定交易的所有日志。过滤出 `OrderFilled` 事件（根据其主题 topic 或合约地址匹配 Polymarket 交易所合约）。Polymarket 有两类撮合合约：
- 普通二元市场使用 **CTF Exchange**，地址 `0x4bFb41...8B8982E`
- 多结果负风险市场使用 **NegRisk_CTFExchange**，地址 `0xC5d563...5220f80a`

这两合约的 `OrderFilled` 事件格式相同。

#### 2. 解析字段含义

按照 Polymarket 交易所合约的定义，提取 `OrderFilled` 日志中的各字段：

**makerAssetId / takerAssetId**：判断资产类型。Polymarket 约定资产 ID 为 0 表示 USDC（稳定币）；非零资产 ID 则对应某市场的头寸 TokenID。每次成交总是一方支付 USDC，另一方支付头寸代币。可以通过比较 AssetId 是否为 0，识别哪一方在支付 USDC、哪一方在支付 Outcome Token。

**makerAmountFilled / takerAmountFilled**：提取成交数量。需要注意不同资产的数量单位：USDC 在链上是 6 位小数精度，头寸代币（ERC-1155）本身不固定精度但通常可以视作与抵押品等值的最小单位（Polymarket 习惯上将数值按 USDC 的最小单位计算交易量）。因此，在计算价格时通常先将这两个数量归一化为实际数量（除以 10^6）。

**price（成交价）**：可通过成交的 USDC 数量除以成交的头寸代币数量得到。为确保小数精度正确，应使用实数计算：

```
price = (USDC_filled / 1e6) / (token_filled / 1e6)
```

简化后实际上就是 `price = USDC_filled / token_filled`（因为双方均以最小单位计数）。

例如，上例中 `makerAmountFilled = 1000000` 表示挂单方出了 1.000000 USDC，`takerAmountFilled = 500000` 表示吃单方出了 0.500000 份头寸（很可能对应 0.5 份 YES 代币，如果 1 份代表 1 USDC 的名义）。则 `price = 1.0 / 0.5 = 2.0 USDC`？（这里数字只是示例，真实情况下一份头寸通常以 1 USDC 为单位价值，所以 0.5 份头寸对应 0.5 USDC 价值，price 应为 0.5/0.5=1.0；示例给的数据似乎假设另一种量级，下文会给出合理案例）。

**tokenId**：确定哪个资产 ID 是 Outcome Token 的 ID。通常我们可以简单判断：哪个 assetId 非 0，就代表具体市场的头寸代币 ID，即 tokenId 字段应填入非零的那个。在极端情况下，如果出现两侧 assetId 都非 0（例如复杂多撮合事件），那可能是一次多市场联动，但 Polymarket 的 `OrderFilled` 单笔记录通常不出现两个非零，因为 USDC 必须参与交易。

**side（买卖方向）**：表示这笔成交相对于该 Token 的买卖方向。为了简化，可按以下规则判断：
- 如果 `makerAssetId = 0`（挂单方出 USDC），意味着挂单方在买入头寸，而吃单方卖出头寸。因此整个成交对于该头寸来说是一次买单成交，我们可以将 side 记为 `"BUY"`。
- 如果 `takerAssetId = 0`（吃单方出 USDC，挂单方出头寸），则表示有人买入 USDC、卖出头寸，对该头寸来说这是一次卖单成交，标记为 `"SELL"`。

Polymarket 官方文档也指出：`makerAssetId` 为 0 意味着订单类型是 BUY（用 USDC 换取结果代币）；`takerAssetId` 为 0 意味着订单类型是 SELL（得到 USDC，卖出结果代币）。因此上述判定与文档定义一致。

#### 3. 组装 JSON 输出

将提取的信息格式化为所需的 JSON。`txHash` 为交易哈希本身，`logIndex` 为日志在交易中的索引（确保唯一定位一条成交记录），`exchange` 为发生交易的合约地址（可以从日志的 address 字段获取），其余字段根据解析结果填入。注意：要保证 price 等数值是友好的可读格式（通常用字符串表示数值即可避免精度问题），side 用大写字符串 `"BUY"` 或 `"SELL"` 表示。

### 示例

假设从交易日志解析得知：
- `makerAssetId = 0`（maker 出 USDC），`takerAssetId = 0x1234...`（某 TokenId）
- `makerAmountFilled = 3000000`（表示 3.000000 USDC）
- `takerAmountFilled = 3000000`（表示 3.000000 份头寸代币；这里可能表示 3 份 YES 或 NO 代币）
- 则 `tokenId = 0x1234...`，`price = (3.000000 USDC) / (3.000000 token) = 1.0 USDC`
- 根据 `makerAssetId = 0`，这笔成交对该 Token 来说是 BUY 方向

输出的 JSON 类似：

```json
{
  "txHash": "0xabc123...def",
  "logIndex": 2,
  "exchange": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  "maker": "0xMakerAddr...",
  "taker": "0xTakerAddr...",
  "makerAssetId": "0",
  "takerAssetId": "0x1234...5678",
  "makerAmountFilled": "3000000",
  "takerAmountFilled": "3000000",
  "price": "1.0",
  "tokenId": "0x1234...5678",
  "side": "BUY"
}
```

这个结果表明：在交易哈希为 `0xabc123` 的订单中，挂单方用 3 USDC 买入了 3 份 TokenId 为 `0x1234...5678` 的头寸，每份价格为 1.0 USDC。

> **注意**：真实链上可能出现更复杂的成交情况，例如一次撮合涉及多条 `OrderFilled` 日志（大订单被多笔小订单填充），或者在负风险市场中一次撮合转化多个头寸。但在初步实现解码器时，我们可以先处理简单场景——即每条 `OrderFilled` 独立解析。如果需要处理更复杂的情况，可以根据 `OrdersMatched` 或结合多条日志进一步整合信息。

---

## 任务 B：市场参数解码 (Market Decoder)

### 问题描述

给定链上获取的市场创建相关信息（如 `ConditionPreparation` 日志，或已知的 `conditionId`），提取并计算出该市场的核心链上参数，包括预言机、问题 ID、抵押品地址，以及 YES/NO 两种头寸的 TokenId。

**输入可能**：
- 直接提供 `conditionId` 值，或
- 一个 `ConditionPreparation` 事件日志记录（其中包含了创建时的 oracle 地址、questionId 等）。

另外，Polymarket 还有 Gamma API 提供的市场元数据，例如通过 slug（市场短标识）查询获取市场信息，其中可能包含 `conditionId` 和头寸 tokenId 列表等。如果使用外部 API，需要校验其数据与链上计算结果一致。

### 输出要求

JSON 结构例如：

```json
{
  "conditionId": "0xabc...123",
  "questionId": "0xdef...456",
  "oracle": "0xOracleAddr...789",
  "collateralToken": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "yesTokenId": "0xYesTokenId...",
  "noTokenId": "0xNoTokenId..."
}
```

其中 `yesTokenId` 和 `noTokenId` 是该市场的 YES/NO 头寸在链上的 ERC-1155 代币 ID。`collateralToken` 为 USDC.e 地址。

### 解码步骤

#### 1. 获取原始参数

如果输入的是日志，直接从 `ConditionPreparation` 事件中读取：

- `conditionId`：日志的主题或数据字段之一。
- `oracle`：预言机合约地址。
- `questionId`：问题标识（bytes32）。
- `outcomeSlotCount`：结果数量（应为 2）。

如果输入只有 `conditionId`，则需要从上下文或其他渠道获得对应的 oracle 和 questionId；通常 Gamma API 的市场数据中会有 questionId 和 oracle 名称等信息以供参考。抵押品 `collateralToken` 在 Polymarket 中几乎总是 USDC.e 的地址，可视作已知常量（或通过 `PositionSplit` 日志交叉验证：该日志通常包含 collateralToken 字段）。

#### 2. 计算 TokenID

按照 Gnosis 条件代币框架计算头寸 token 的 ID：

**CollectionId**：先计算针对 YES 和 NO 的集合 ID。使用框架提供的方法或公式：

```
collectionId_yes = keccak256(parentCollectionId, conditionId, 1)
collectionId_no = keccak256(parentCollectionId, conditionId, 2)
```

其中：
- `parentCollectionId = bytes32(0)`
- `1` 表示 `indexSet = 0b01` 对应第一个结果槽
- `2` 表示 `indexSet = 0b10` 对应第二个结果槽

Polymarket 官方也有相同定义。这一步得到一对 bytes32 的 collectionId，对应该市场的两个互斥结果。

**PositionId (TokenId)**：再将抵押品代币地址与上述 collectionId 结合哈希：

```
yesTokenId = keccak256(collateralToken, collectionId_yes)
noTokenId = keccak256(collateralToken, collectionId_no)
```

这样就得到了该市场 YES 和 NO 份额的 TokenId。因为 `collateralToken` 对于 Polymarket 当前固定为 USDC.e，所以某种意义上 TokenId 由 conditionId 和 indexSet 唯一决定。（在实现中，可直接调用已部署的 ConditionalTokens 合约的 `getPositionId` 方法，或使用 solidity/python 等方式手动计算哈希值。Polymarket 文档明确给出了计算步骤和顺序。）

#### 3. 组装输出并验证

将得到的参数填入 JSON。为了验证正确性，可以交叉检查：

- 计算所得 `yesTokenId` / `noTokenId` 是否和 Gamma API 返回的 `clobTokenIds` 匹配（如果有使用 Gamma 数据）。Polymarket Gamma API 的 Market 信息通常会列出这个市场对应的两个 tokenId，以供前端下单等使用。我们的计算结果应与之完全一致，否则可能说明输入有误或我们计算有误。
- 如果事先解析过该市场的交易（任务 A），可以检查某笔交易解析出的 tokenId 是否等于这里算出的 yes/no TokenId 之一。如果匹配上了，说明这个交易确实属于该市场。例如，若 Trade Decoder 输出的一笔交易 `tokenId = 0x...89`，而 Market Decoder 计算的 `yesTokenId = 0x...89`，则可以确认这笔交易是在买卖该市场的 YES 份额。

通过 Market Decoder，我们能从链上推断出市场的基础结构（问题、预言机、抵押品、头寸资产 ID 等）。配合 Trade Decoder，可以进一步将链上交易记录归类到各个市场中，奠定索引器开发的基础。

### 数据示例

假设通过 Gamma API 查询到 slug 为 `"fed-rate-jan2024"` 的市场信息，得到了 `conditionId = 0xabc...123`，Oracle 为 UMAAdapterV2 地址 `0xUMA...oracle`，`questionId = 0xdef...456`。我们知道 `collateralToken = USDC.e (0x2791...Aa84174)`。按照上述步骤计算：

```
collectionId_yes = keccak256(0x0, 0xabc...123, 1)
collectionId_no = keccak256(0x0, 0xabc...123, 2)
yesTokenId = keccak256(0x2791...Aa84174, collectionId_yes)
noTokenId = keccak256(0x2791...Aa84174, collectionId_no)
```

最终输出：

```json
{
  "conditionId": "0xabc...123",
  "questionId": "0xdef...456",
  "oracle": "0xUMA...oracle",
  "collateralToken": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "yesTokenId": "0xAAA...111",
  "noTokenId": "0xBBB...222"
}
```

并可验证 Trade Decoder 获取的所有交易 tokenId 在这两个值之中。

---

## 注意事项

### 精度与单位

在计算价格或组装输出时，要注意 USDC 的精度是 6 位（小数点后 6 位）。Polymarket 头寸代币由于基于抵押品拆分，通常也是按 USDC 的基础单位发行（1 份代币 = 1 USDC 抵押）。很多链上数据（如 `makerAmountFilled`）是整数形式，需要除以 `1e6` 转成人类可读的数量。

### 方向判定

我们的 Trade Decoder 里简单用 `makerAssetId` 是否为 0 来判定买卖。如果需要更精细，也可以结合 maker 或 taker 是不是用户自身来决定视角（但一般而言，用资产类别判断交易方向就足够，如上文规则）。

### 复杂订单

负风险市场中，可能出现单笔交易一个 `OrderFilled` 订单撮合同时涉及多个市场的情形（通过 NO 到 YES 的转换）。这种情况下会出现特殊的 `PositionsConverted` 事件。基础版本的解码器可以暂不处理此类复杂日志，但在设计上应考虑留意同一交易 hash 中是否存在多个 `OrderFilled` 以及 `PositionsConverted`，以免误分类交易归属。

---

## 数据固化 (Fixtures)

在开发和测试过程中，建议将上述解析得到的关键数据保存为 JSON 文件，方便离线测试。例如：

- 将 Polygon 上抓取的交易回执（包含日志的 transaction receipt）保存为 `fixtures/tx_<hash>.json`
- 将 Gamma API 获取的市场信息结果保存为 `fixtures/market_<slug>.json`

这样做可以确保在没有链上连接时也能进行解析函数的单元测试，并保证解析逻辑的幂等和正确。

---

## 参考实现示例

以下是基于本项目代码的具体示例，供学习和参考。

### 环境配置

1. 复制 `.env.example` 为 `.env` 并填入必要配置：

```bash
cp .env.example .env
```

2. 安装依赖：

```bash
pip install -r requirements.txt
```

3. 配置 RPC URL（必需，可使用 Alchemy/Infura 等 Polygon RPC 服务）：

```
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

### 示例交易哈希

项目中使用的示例交易哈希：

```
0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946
```

该交易包含了 Polymarket 的 `OrderFilled` 事件，可用于测试交易解码器。

### Trade Decoder 示例

`src/trade_decoder.py` 实现了交易日志解析功能。核心数据结构：

```python
@dataclass(frozen=True)
class Trade:
    tx_hash: str
    log_index: int
    exchange: str
    order_hash: str
    maker: str
    taker: str
    maker_asset_id: str
    taker_asset_id: str
    maker_amount: str
    taker_amount: str
    fee: str
    price: str
    token_id: str
    side: str
```

价格与方向判定逻辑：

```python
if maker_asset_id == 0:  # maker 出 USDC
    price = Decimal(maker_amount) / Decimal(taker_amount)
    token_id = taker_asset_id
    side = "BUY"
else:  # maker 出 Token
    price = Decimal(taker_amount) / Decimal(maker_amount)
    token_id = maker_asset_id
    side = "SELL"
```

### Market Decoder 示例

`src/market_decoder.py` 实现了市场参数解码功能。TokenId 计算使用 `src/ctf/derive.py` 中的 `derive_binary_positions` 函数：

```python
positions = derive_binary_positions(
    oracle=oracle,
    question_id=question_id,
    condition_id=condition_id,
    collateral_token=collateral_token,
)
# positions.position_yes -> YES Token ID
# positions.position_no  -> NO Token ID
```

### Gamma API 集成

`src/indexer/gamma.py` 提供了与 Gamma API 交互的函数：

```python
# 按 slug 获取事件
event = fetch_event_by_slug(base_url, "will-there-be-another-us-government-shutdown-by-january-31")

# 按 slug 获取市场
market = fetch_market_by_slug(base_url, market_slug)

# 按 conditionId 或 tokenIds 查找市场
market = fetch_market_by_condition_or_tokens(base_url, condition_id=cid, token_ids=[tid])
```

---

## 验证命令规范

> **重要提示**：任务验收将**严格按照以下规范**进行。请确保你的实现能够通过下述所有验证命令，并产出符合规定格式的输出。**不符合规范的提交将无法通过验收。**

完成任务后，请使用以下统一命令进行验证。所有命令均在 `stage1/` 目录下执行。

### 前置检查

```bash
# 确保环境配置正确
cp .env.example .env
# 编辑 .env 填入有效的 RPC_URL

# 安装依赖
pip install -r requirements.txt
```

### 任务 A：交易解码器验证

```bash
# 基础用法：解析指定交易的 OrderFilled 事件
python -m src.trade_decoder --tx-hash 0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946

# 输出到文件
python -m src.trade_decoder \
    --tx-hash 0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946 \
    --output ./data/trades.json
```

**预期输出格式**：

```json
[
  {
    "tx_hash": "0x916cad...",
    "log_index": 123,
    "exchange": "0xC5d563A36AE78145C45a50134d48A1215220f80a",
    "maker": "0x...",
    "taker": "0x...",
    "maker_asset_id": "0",
    "taker_asset_id": "12345...",
    "maker_amount": "1000000",
    "taker_amount": "1000000",
    "price": "1.0",
    "token_id": "12345...",
    "side": "BUY"
  }
]
```

### 任务 B：市场解码器验证

```bash
# 通过 Gamma API slug 获取市场信息并计算 TokenId
python -m src.market_decoder \
    --market-slug will-there-be-another-us-government-shutdown-by-january-31

# 通过交易哈希解析 ConditionPreparation 事件
python -m src.market_decoder \
    --tx-hash <condition_preparation_tx_hash> \
    --log-index <log_index>

# 输出到文件
python -m src.market_decoder \
    --market-slug will-there-be-another-us-government-shutdown-by-january-31 \
    --output ./data/market.json
```

**预期输出格式**：

```json
{
  "conditionId": "0xabc...123",
  "oracle": "0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49",
  "questionId": "0xdef...456",
  "outcomeSlotCount": 2,
  "collateralToken": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "yesTokenId": "0xYYY...",
  "noTokenId": "0xZZZ...",
  "gamma": { ... }
}
```

### 综合演示

```bash
# 运行完整 demo，同时执行交易解析和市场解码
python -m src.demo \
    --tx-hash 0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946 \
    --event-slug will-there-be-another-us-government-shutdown-by-january-31 \
    --output ./data/demo_output.json
```

**预期输出**：

```json
{
  "stage1": {
    "tx_hash": "0x916cad...",
    "trades": [ ... ],
    "position_split": { ... },
    "market": {
      "conditionId": "...",
      "oracle": "...",
      "questionId": "...",
      "collateralToken": "...",
      "yesTokenId": "...",
      "noTokenId": "..."
    },
    "gamma": { ... }
  }
}
```

### 验证清单（必须全部通过）

以下所有检查项均为**必须通过**的验收标准：

- [ ] `trade_decoder` 能正确解析 `OrderFilled` 事件并输出交易详情
- [ ] `trade_decoder` 正确计算 `price`、`side`、`token_id`
- [ ] `trade_decoder` 正确过滤 `taker == exchange` 的重复日志
- [ ] `market_decoder` 能从 Gamma API 获取市场信息
- [ ] `market_decoder` 能正确计算 `yesTokenId` 和 `noTokenId`
- [ ] 计算得到的 TokenId 与 Gamma API 返回的 `clobTokenIds` 一致
- [ ] `demo` 脚本能整合两个任务并输出完整结果

### 验收标准说明

1. **命令格式**：验收时将使用上述规定的命令格式运行你的代码，请确保命令行参数与规范一致。
2. **输出格式**：JSON 输出必须包含规定的所有字段，字段名称必须与示例完全一致（区分大小写）。
3. **数据正确性**：使用示例交易哈希 `0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946` 进行验证，解码结果将与标准答案比对。
4. **代码可运行**：提交的代码必须在配置好 `.env` 后能够直接运行，不能有额外的手动配置步骤。
