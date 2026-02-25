# Polymarket 交易和市场分析工具集

本工具集提供了完整的 Polymarket 链上数据分析工具，包括交易解码、市场参数解码、批量市场数据获取等功能。

## 工具列表

### 1. 交易日志解码器 (trade_decoder.py)
解析 Polygon 链上的 Polymarket 交易日志，提取 `OrderFilled` 事件并解码为结构化数据。

### 2. 市场参数解码器 (market_decoder.py)
根据 `conditionId` 或交易哈希，计算市场的核心链上参数。  
📖 [详细文档](MARKET_DECODER_README.md)

### 3. 批量市场数据获取器 (fetch_recent_markets.py) 🆕
通过 Gamma API 批量获取最近创建的市场数据和 conditionId。  
📖 [详细文档](FETCH_RECENT_MARKETS_README.md)

---

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

依赖库：
- `web3>=6.0.0`
- `requests>=2.28.0`

---

## 1. 交易日志解码器 (trade_decoder.py)

### 功能说明

这个脚本用于解析 Polygon 链上的 Polymarket 交易日志，提取 `OrderFilled` 事件并解码为结构化的 JSON 数据。

## 使用方法

### 基本用法

```bash
python trade_decoder.py <交易哈希>
```

### 完整参数

```bash
python trade_decoder.py <交易哈希> [--rpc-url <RPC_URL>] [--output <输出文件>]
```

### 参数说明

- `tx_hash`: 交易哈希（必需），可以是 `0x` 开头或直接输入哈希值
- `--rpc-url`: Polygon RPC URL（可选），默认为 `https://polygon-rpc.com`
- `--output` / `-o`: 输出 JSON 文件路径（可选），如果不指定则输出到标准输出

### 示例

```bash
# 基本用法，输出到标准输出
python trade_decoder.py 0xfa0746b1...9198

# 指定 RPC URL 和输出文件
python trade_decoder.py 0xfa0746b1...9198 --rpc-url https://polygon-rpc.com --output trade.json

# 使用自定义 RPC（如 Alchemy、Infura）
python trade_decoder.py 0xfa0746b1...9198 --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY --output trade.json
```

## 输出格式

### 单笔交易

如果交易中只有一个 `OrderFilled` 事件，输出格式如下：

```json
{
  "txHash": "0xfa0746b1...9198",
  "logIndex": 123,
  "exchange": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  "maker": "0x...",
  "taker": "0x...",
  "makerAssetId": "0",
  "takerAssetId": "0x1234...5678",
  "makerAmountFilled": "3000000",
  "takerAmountFilled": "3000000",
  "price": "1.0",
  "tokenId": "0x1234...5678",
  "side": "BUY"
}
```

### 多笔交易

如果交易中有多个 `OrderFilled` 事件，输出格式如下：

```json
{
  "txHash": "0xfa0746b1...9198",
  "tradeCount": 2,
  "trades": [
    {
      "txHash": "0xfa0746b1...9198",
      "logIndex": 123,
      "exchange": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
      ...
    },
    {
      "txHash": "0xfa0746b1...9198",
      "logIndex": 124,
      "exchange": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
      ...
    }
  ]
}
```

## 字段说明

- `txHash`: 交易哈希
- `logIndex`: 日志在交易中的索引位置
- `exchange`: 交易所合约地址
  - `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`: CTF Exchange（普通二元市场）
  - `0xC5d563A36AE78145C45a50134d48A1215220f80a`: NegRisk CTF Exchange（负风险市场）
- `maker`: 挂单方地址
- `taker`: 吃单方地址
- `makerAssetId`: Maker 提供的资产ID（"0" 表示 USDC）
- `takerAssetId`: Taker 提供的资产ID（"0" 表示 USDC）
- `makerAmountFilled`: Maker 支付的资产数量（整数，需要除以 1e6 得到实际数量）
- `takerAmountFilled`: Taker 支付的资产数量（整数，需要除以 1e6 得到实际数量）
- `price`: 成交价格（USDC per token，已计算好）
- `tokenId`: 本次交易涉及的 Outcome Token ID（非 USDC 的资产ID）
- `side`: 交易方向
  - `"BUY"`: 买入 Outcome Token（用 USDC 换取代币）
  - `"SELL"`: 卖出 Outcome Token（用代币换取 USDC）

## 价格计算逻辑

价格计算公式：
```
price = (USDC数量 / 1e6) / (Token数量 / 1e6) = USDC数量 / Token数量
```

其中：
- USDC 数量：支付 USDC 的一方提供的数量
- Token 数量：支付 Outcome Token 的一方提供的数量
- 两个数量都以最小单位（1e6）计数

## 买卖方向判断

- 如果 `makerAssetId = "0"`（Maker 出 USDC），则 `side = "BUY"`（买入代币）
- 如果 `takerAssetId = "0"`（Taker 出 USDC），则 `side = "SELL"`（卖出代币）

## 注意事项

1. **RPC 限制**: 免费 RPC 可能有速率限制，建议使用付费 RPC 服务（如 Alchemy、Infura）以获得更好的性能
2. **网络连接**: 确保能够访问 Polygon 网络
3. **交易存在性**: 如果交易不存在或尚未确认，脚本会报错
4. **事件过滤**: 脚本只会解析来自 Polymarket 交易所合约的 `OrderFilled` 事件

## 错误处理

- 如果交易不存在，会显示错误信息并退出
- 如果交易中没有 `OrderFilled` 事件，会提示并退出
- 如果 RPC 连接失败，会显示连接错误

---

## 2. 市场参数解码器 (market_decoder.py)

根据 `conditionId` 或 `ConditionPreparation` 事件，计算市场的核心链上参数。

### 快速开始

```bash
# 通过 Gamma slug 获取并验证市场参数
python market_decoder.py --gamma-slug fed-rate-jan2024 --verify

# 通过交易哈希解码
python market_decoder.py --tx-hash 0x123... --log-index 5
```

📖 [查看完整文档](MARKET_DECODER_README.md)

---

## 3. 批量市场数据获取器 (fetch_recent_markets.py) 🆕

通过 Polymarket Gamma API 批量获取市场信息，提取 `conditionId` 和关键数据。

### 快速开始

```bash
# 获取最近 7 天的前 100 个活跃市场
python fetch_recent_markets.py --days 7 --limit 100 --active-only

# 导出为 CSV 格式
python fetch_recent_markets.py --days 7 --csv --output markets.csv

# 按交易量排序获取热门市场
python fetch_recent_markets.py --active-only --limit 50 --output hot_markets.json
```

### 主要功能

- ✅ 批量获取指定时间范围内的市场
- ✅ 支持按活跃状态过滤
- ✅ 多种排序方式（交易量、创建时间、流动性等）
- ✅ 支持 JSON 和 CSV 导出
- ✅ 自动分页，突破 API 单次限制

📖 [查看完整文档](FETCH_RECENT_MARKETS_README.md)

---

## 工作流示例

### 示例 1: 分析热门市场

```bash
# 1. 获取交易量最高的 20 个市场
python fetch_recent_markets.py --active-only --limit 20 --output hot_markets.json

# 2. 提取第一个市场的 slug（使用 jq）
slug=$(cat hot_markets.json | jq -r '.[0].slug')

# 3. 解码该市场的详细参数
python market_decoder.py --gamma-slug "$slug" --verify
```

### 示例 2: 批量解码市场

```bash
# 1. 获取最近 7 天的市场
python fetch_recent_markets.py --days 7 --limit 50 --output markets.json

# 2. 批量解码所有 conditionId
cat markets.json | jq -r '.[].conditionId' | while read cid; do
    echo "=== Decoding $cid ==="
    python market_decoder.py --condition-id "$cid"
done
```

### 示例 3: 交易分析

```bash
# 1. 获取某个交易的解码数据
python trade_decoder.py 0xfa0746b1...9198 --output trade.json

# 2. 提取 tokenId
token_id=$(cat trade.json | jq -r '.ordersFilled[0].tokenId')

# 3. 查找对应的市场（需要自行编写脚本匹配 tokenId）
```

---

## 常见问题 (FAQ)

### Q: 为什么 trade_decoder 和 market_decoder 不同？

A: 
- `trade_decoder.py`: 解析**交易日志**，提取已成交的订单信息（OrderFilled 事件）
- `market_decoder.py`: 解析**市场创建事件**，计算市场的链上参数（ConditionPreparation 事件）

### Q: 如何获取某个市场的所有交易？

A: 需要使用区块链浏览器 API 或 Graph 查询，本工具集暂不支持批量交易查询。

### Q: conditionId 和 tokenId 的关系？

A: 
- `conditionId`: 唯一标识一个市场（一个问题）
- `tokenId`: 每个市场有多个 tokenId（YES/NO 或多个选项）
- 关系：`tokenId = getPositionId(collateral, collectionId(conditionId, indexSet))`

### Q: 免费 RPC 够用吗？

A: 对于少量查询够用，但如果需要批量查询建议使用：
- [Alchemy](https://www.alchemy.com/)
- [Infura](https://www.infura.io/)
- [QuickNode](https://www.quicknode.com/)

---

## 技术支持

如有问题或建议，请在项目中提 Issue。

## 许可证

与 OGBC-Intern-Project 保持一致。

## 示例输出

```bash
$ python trade_decoder.py 0xabc123...def
Decoding transaction: 0xabc123...def
RPC URL: https://polygon-rpc.com
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
