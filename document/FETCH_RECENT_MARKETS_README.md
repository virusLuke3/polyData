# Polymarket 批量市场数据获取工具

## 功能描述

`fetch_recent_markets.py` 是一个通过 Polymarket Gamma API 批量获取市场信息的工具，特别适用于获取最近创建的市场的 `conditionId`。

## 主要特性

- ✅ 批量获取指定时间范围内的市场数据
- ✅ 支持按活跃状态过滤（活跃/关闭/全部）
- ✅ 支持多种排序方式（交易量、创建时间、结束时间、流动性）
- ✅ 支持 JSON 和 CSV 两种导出格式
- ✅ 自动提取 `conditionId` 和关键市场信息
- ✅ 分页获取，支持大批量数据（可超过 API 单次限制）

## 安装依赖

```bash
pip install -r requirements.txt
```

依赖库：
- `requests>=2.28.0`

## 使用方法

### 基本用法

```bash
# 获取最近 7 天的前 100 个市场
python fetch_recent_markets.py --days 7 --limit 100

# 只获取活跃市场
python fetch_recent_markets.py --active-only --limit 50

# 指定输出文件
python fetch_recent_markets.py --days 7 --output markets.json
```

### 导出为 CSV

```bash
# 导出为 CSV 格式
python fetch_recent_markets.py --days 7 --csv --output markets.csv

# 只获取活跃市场并导出 CSV
python fetch_recent_markets.py --active-only --limit 50 --csv --output active_markets.csv
```

### 高级选项

```bash
# 按创建时间排序
python fetch_recent_markets.py --days 7 --order-by createdAt --limit 100

# 按流动性排序
python fetch_recent_markets.py --order-by liquidity --limit 50

# 只获取已关闭的市场
python fetch_recent_markets.py --closed-only --limit 100

# 不显示摘要信息
python fetch_recent_markets.py --days 7 --no-summary --output markets.json
```

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--days` | 获取最近几天的市场 | 7 |
| `--limit` | 最多获取的市场数量 | 100 |
| `--active-only` | 只获取活跃市场 | False |
| `--closed-only` | 只获取已关闭市场 | False |
| `--order-by` | 排序字段 (`volume24hr`, `endDate`, `createdAt`, `liquidity`) | volume24hr |
| `--output` | 输出文件路径 | 自动生成 |
| `--csv` | 以 CSV 格式输出 | False (默认 JSON) |
| `--no-summary` | 不打印摘要信息 | False |

## 输出数据格式

### JSON 格式示例

```json
[
  {
    "conditionId": "0x17815081230e3b9c78b098162c33b1ffa68c4ec29c123d3d14989599e0c2e113",
    "question": "Fed decreases interest rates by 50+ bps after January 2026 meeting?",
    "slug": "fed-decreases-interest-rates-by-50-bps-after-january-2026-meeting",
    "marketSlug": null,
    "active": true,
    "closed": false,
    "volume": "226876389.697259",
    "liquidity": "9659452.60628",
    "outcomeTokens": null,
    "endDate": "2026-01-28T00:00:00Z",
    "createdAt": "2025-09-17T16:22:35.837625Z",
    "tokenIds": ["123...", "456..."],
    "outcomes": ["Yes", "No"]
  }
]
```

### CSV 格式

包含以下主要字段：
- `conditionId`: 市场条件 ID（用于链上交互）
- `question`: 市场问题
- `slug`: 市场唯一标识符
- `active`: 是否活跃
- `closed`: 是否已关闭
- `volume`: 交易量
- `liquidity`: 流动性
- `endDate`: 结束时间
- `createdAt`: 创建时间

## 输出示例

```
🔄 正在获取最近 7 天的市场...
   起始日期: 2026-01-21 15:12:29
   活跃状态: 仅活跃

📥 获取批次 1 (offset=0, limit=5)... ✅ 获取 5 个市场

✅ 共获取 5 个符合条件的市场

============================================================
📊 市场摘要
============================================================
总市场数: 5
活跃市场: 5
关闭市场: 0
有 conditionId: 5

============================================================
📝 前 5 个市场示例
============================================================

1. Fed decreases interest rates by 50+ bps after January 2026 meeting?
   conditionId: 0x17815081230e3b9c78b098162c33b1ffa68c4ec29c123d3d14989599e0c2e113
   slug: fed-decreases-interest-rates-by-50-bps-after-january-2026-meeting
   状态: ✅ 活跃
   交易量: $226,876,389.70

💾 数据已保存到: markets.json
```

## 与 market_decoder.py 配合使用

获取到 `conditionId` 后，可以使用 `market_decoder.py` 解码市场参数：

```bash
# 1. 批量获取市场
python fetch_recent_markets.py --days 7 --limit 50 --output markets.json

# 2. 使用 jq 提取 conditionId
cat markets.json | jq -r '.[0].conditionId'

# 3. 解码市场参数
python market_decoder.py --gamma-slug fed-decreases-interest-rates-by-50-bps-after-january-2026-meeting --verify
```

## 技术细节

### API 限制

- Gamma API 单次请求最多返回 100 个市场
- 脚本会自动分页获取，直到达到 `--limit` 指定的数量
- 如果网络不稳定，建议使用较小的 `--limit` 值

### 日期过滤逻辑

脚本通过以下逻辑过滤市场：
1. 优先检查 `createdAt` 字段，保留最近 N 天创建的市场
2. 如果没有 `createdAt`，检查 `endDate`，保留未来或最近 N 天结束的市场
3. 这确保了获取的是"活跃"或"近期相关"的市场

### 排序选项

- `volume24hr`: 按 24 小时交易量排序（推荐，获取热门市场）
- `createdAt`: 按创建时间排序（获取最新市场）
- `endDate`: 按结束时间排序（获取即将结束的市场）
- `liquidity`: 按流动性排序（获取流动性最好的市场）

## 常见问题

### Q: 为什么实际获取的市场数量少于 `--limit`？

A: 可能的原因：
1. API 返回的数据中，符合日期范围的市场不足
2. 活跃状态过滤（`--active-only`）排除了部分市场
3. Gamma API 的数据总量有限

### Q: 如何获取所有市场（不限日期）？

A: 设置一个很大的 `--days` 值，例如：
```bash
python fetch_recent_markets.py --days 365 --limit 1000
```

### Q: CSV 文件中为什么有些字段为空？

A: Gamma API 返回的数据中，某些字段可能不存在（如 `marketSlug`、`outcomeTokens`）。CSV 格式只包含简单类型的字段，复杂类型（如数组、对象）会被过滤掉。如需完整数据，请使用 JSON 格式。

## 相关文档

- [Polymarket Gamma API 文档](https://docs.polymarket.com/)
- [市场解码工具 README](MARKET_DECODER_README.md)

## 示例工作流

### 1. 获取热门活跃市场

```bash
# 获取交易量最高的前 20 个活跃市场
python fetch_recent_markets.py --active-only --limit 20 --output hot_markets.json
```

### 2. 监控新创建的市场

```bash
# 按创建时间排序，获取最新的 50 个市场
python fetch_recent_markets.py --days 1 --order-by createdAt --limit 50 --output new_markets.json
```

### 3. 分析已关闭市场

```bash
# 获取最近 30 天已关闭的市场，导出为 CSV 用于分析
python fetch_recent_markets.py --days 30 --closed-only --limit 200 --csv --output closed_markets.csv
```

### 4. 数据处理管道

```bash
# 1. 获取数据
python fetch_recent_markets.py --days 7 --limit 100 --output markets.json

# 2. 提取所有 conditionId（使用 jq）
cat markets.json | jq -r '.[].conditionId' > condition_ids.txt

# 3. 批量解码（shell 脚本）
while read condition_id; do
    python market_decoder.py --condition-id "$condition_id" >> decoded_markets.txt
done < condition_ids.txt
```

## 许可证

与 OGBC-Intern-Project 保持一致。
