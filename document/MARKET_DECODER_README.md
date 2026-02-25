# Polymarket 市场参数解码器

## 功能说明

这个脚本用于根据 `conditionId` 或 `ConditionPreparation` 事件日志，计算市场的核心链上参数，包括：
- 预言机地址
- 问题ID
- 抵押品地址
- YES/NO 两种头寸的 TokenId

## 安装依赖

```bash
pip install -r requirements.txt
```

## 使用方法

### 方式1: 从 conditionId 计算

```bash
python market_decoder.py \
  --condition-id <conditionId> \
  --oracle <oracle_address> \
  --question-id <questionId>
```

**示例**：
```bash
python market_decoder.py \
  --condition-id 0xabc123... \
  --oracle 0xOracleAddr... \
  --question-id 0xdef456...
```

### 方式2: 从交易日志解码

```bash
python market_decoder.py \
  --tx-hash <transaction_hash> \
  --log-index <log_index> \
  [--rpc-url <rpc_url>]
```

**示例**：
```bash
python market_decoder.py \
  --tx-hash 0x123... \
  --log-index 5 \
  --rpc-url https://polygon-rpc.com
```

### 方式3: 从 Gamma API 获取

```bash
python market_decoder.py \
  --gamma-slug <market_slug> \
  [--verify] \
  [--use-onchain]
```

**示例**：
```bash
# 基本用法
python market_decoder.py --gamma-slug fed-rate-jan2024

# 使用 Gamma API 验证计算结果
python market_decoder.py --gamma-slug fed-rate-jan2024 --verify

# 调用链上合约获取精确的 collectionId
python market_decoder.py --gamma-slug fed-rate-jan2024 --use-onchain --rpc-url https://polygon-rpc.com
```

## 参数说明

### 输入参数（三选一）

- `--condition-id`: 条件ID（需要同时提供 `--oracle` 和 `--question-id`）
- `--tx-hash`: 交易哈希（需要同时提供 `--log-index`）
- `--gamma-slug`: Gamma API 市场 slug

### 其他参数

- `--oracle`: 预言机地址（与 `--condition-id` 一起使用）
- `--question-id`: 问题ID（与 `--condition-id` 一起使用）
- `--log-index`: 日志索引（与 `--tx-hash` 一起使用）
- `--rpc-url`: Polygon RPC URL（默认: `https://polygon-rpc.com`）
- `--collateral-token`: 抵押品代币地址（默认: USDC.e 地址）
- `--ctf-address`: ConditionalTokens 合约地址（默认: Polygon 上的 CTF 地址）
- `--use-onchain`: 调用链上合约获取精确的 collectionId（需要 RPC 连接）
- `--verify`: 使用 Gamma API 验证计算结果（仅与 `--gamma-slug` 一起使用）
- `--output` / `-o`: 输出 JSON 文件路径（如果不指定，输出到标准输出）

## 输出格式

```json
{
  "conditionId": "0xabc...123",
  "questionId": "0xdef...456",
  "oracle": "0xOracleAddr...789",
  "collateralToken": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "yesTokenId": "109481274475493425970596827677940251230949629097350877114100869237412591744780",
  "noTokenId": "104358431329216429451595299019941485956554291099834150907165889053748376265933"
}
```

## 字段说明

- `conditionId`: 条件ID（bytes32）
- `questionId`: 问题ID（bytes32）
- `oracle`: 预言机合约地址
- `collateralToken`: 抵押品代币地址（通常是 USDC.e）
- `yesTokenId`: YES 头寸的 ERC-1155 Token ID（uint256 字符串）
- `noTokenId`: NO 头寸的 ERC-1155 Token ID（uint256 字符串）

## 计算原理

### 1. ConditionId 计算

```
conditionId = keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount))
```

### 2. CollectionId 计算

**简化版本**（文档中描述）：
```
collectionId = keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet))
```

**完整版本**（CTF 实际实现）：
- 涉及椭圆曲线运算（alt_bn128 曲线）
- 对于 `parentCollectionId = 0`（Polymarket 的情况），可以简化
- 使用 `--use-onchain` 选项可以调用链上合约获取精确结果

### 3. PositionId (TokenId) 计算

```
positionId = keccak256(abi.encodePacked(collateralToken, collectionId))
```

然后转换为 `uint256` 格式。

## 注意事项

1. **CollectionId 计算的复杂性**：
   - CTF 的 `getCollectionId` 实现涉及椭圆曲线运算
   - 文档中描述的简化版本可能在某些情况下不够精确
   - 建议使用 `--use-onchain` 选项调用链上合约获取精确结果

2. **Gamma API 验证**：
   - 使用 `--verify` 选项可以对比计算结果与 Gamma API 返回的 tokenIds
   - 如果不匹配，可能需要使用 `--use-onchain` 选项

3. **RPC 连接**：
   - 使用 `--use-onchain` 需要有效的 RPC 连接
   - 免费 RPC 可能有速率限制，建议使用付费 RPC 服务

4. **TokenId 格式**：
   - TokenId 以字符串形式输出（因为 uint256 可能超出 Python int 范围）
   - 这是 ERC-1155 代币的标准 ID 格式

## 示例输出

```bash
$ python market_decoder.py --gamma-slug fed-rate-jan2024
Fetching market data from Gamma API: fed-rate-jan2024
{
  "conditionId": "0xabc123...",
  "questionId": "0xdef456...",
  "oracle": "0xOracleAddr...",
  "collateralToken": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  "yesTokenId": "109481274475493425970596827677940251230949629097350877114100869237412591744780",
  "noTokenId": "104358431329216429451595299019941485956554291099834150907165889053748376265933"
}
```

## 与 Trade Decoder 配合使用

Market Decoder 计算的 `yesTokenId` 和 `noTokenId` 可以与 Trade Decoder 的输出进行匹配：

```bash
# 1. 解码交易，获取 tokenId
python trade_decoder.py 0xabc123... > trade.json

# 2. 解码市场，获取 yesTokenId 和 noTokenId
python market_decoder.py --gamma-slug market-slug > market.json

# 3. 匹配：trade.json 中的 tokenId 应该等于 market.json 中的 yesTokenId 或 noTokenId
```

这样可以确定交易属于哪个市场，以及交易的是 YES 还是 NO 头寸。
