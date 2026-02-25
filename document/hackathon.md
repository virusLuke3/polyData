# 阶段三：Polymarket 生态黑客松挑战

## 赛道概述

基于阶段一（链上数据解码）和阶段二（索引器构建）所学的技能，本阶段鼓励参赛者**自由发挥创意**，构建有实际价值的 Polymarket 生态应用或工具。

**核心主题**：利用 Polymarket 链上数据，创造有价值的数据产品、分析工具或创新应用。

---

## 项目创意方向（供参考，不限于此）

### 方向 A：数据分析与可视化

#### A1. 市场情绪仪表盘 (Market Sentiment Dashboard)
构建一个实时展示 Polymarket 市场情绪的可视化面板：
- 追踪热门市场的价格变化趋势
- 展示大单交易（鲸鱼活动）警报
- 显示市场深度和买卖压力指标
- 历史价格 K 线图

#### A2. 交易者画像分析 (Trader Profiling)
基于链上交易历史，分析和识别不同类型的交易者：
- 识别"聪明钱"地址（高胜率交易者）
- 追踪 KOL/大户的持仓变化
- 生成地址的交易风格标签（套利者、趋势跟随者、做市商等）
- 提供"跟单"信号或排行榜

#### A3. 跨市场套利监控 (Cross-Market Arbitrage Monitor)
检测并展示 Polymarket 内部或跨平台的套利机会：
- 监控负风险事件中不同市场间的价格不一致
- 检测 YES + NO 价格偏离 $1 的套利空间
- 实时计算潜在收益和风险

### 方向 B：交易辅助工具

#### B1. 智能下单助手 (Smart Order Assistant)
帮助用户更高效地在 Polymarket 交易：
- 基于历史成交数据推荐最优下单价格
- 预测订单成交概率和等待时间
- 提供滑点估算和交易成本分析

#### B2. 持仓风险计算器 (Portfolio Risk Calculator)
为用户提供持仓风险分析：
- 输入钱包地址，自动获取其 Polymarket 持仓
- 计算组合的最大损失、预期收益
- 模拟不同市场结果下的 PnL 情景分析
- 提供对冲建议

#### B3. 市场结算追踪器 (Resolution Tracker)
追踪即将结算的市场并提供提醒：
- 展示即将到期的市场列表
- 追踪预言机（UMA）的报告状态
- 提供结算历史和争议案例分析

### 方向 C：创新应用

#### C1. 预测市场社交层 (Prediction Social Layer)
为 Polymarket 添加社交功能：
- 用户可以发布对市场的分析和预测理由
- 追踪和展示意见领袖的历史预测准确率
- 建立基于链上数据的信誉系统

#### C2. 市场创建建议器 (Market Proposal Engine)
帮助发现新的预测市场机会：
- 分析现有市场的交易活跃度和流动性
- 基于新闻或事件建议可能的新市场主题
- 预估新市场的潜在交易量

#### C3. 链上数据 API 服务 (On-chain Data API)
构建一个更完善的 Polymarket 数据 API：
- 提供比官方 Gamma API 更详细的链上数据
- 支持更灵活的查询条件（时间范围、地址过滤等）
- 提供 WebSocket 实时推送
- 添加历史快照功能

#### C4. 多链/多平台聚合 (Multi-Platform Aggregator)
将 Polymarket 与其他预测市场平台数据整合：
- 对比同一事件在不同平台的定价差异
- 提供跨平台流动性聚合视图
- 识别跨平台套利机会

---

## 最低获奖门槛

为确保作品质量，参赛者必须满足以下**最低要求**才有资格获得该赛道奖项：

### 必须满足的基础要求（全部）

| 要求 | 说明 |
|------|------|
| **数据来源** | 必须使用 Polygon 链上的 Polymarket 真实数据（通过 RPC 或索引器获取） |
| **数据验证** | 必须展示从链上获取并解码的真实交易或市场数据（至少 100 条交易记录） |
| **可运行** | 提交的代码必须能够在评审环境中成功运行并产出预期结果 |
| **文档完整** | 必须包含 README 说明如何运行项目，以及简要的技术架构说明 |

### 技术基线要求（至少满足 2 项）

| 要求 | 说明 |
|------|------|
| **交易解码** | 正确解析 `OrderFilled` 事件，包括价格、方向、TokenId |
| **市场识别** | 能将交易归类到对应的市场（通过 TokenId 匹配） |
| **数据存储** | 使用数据库持久化存储链上数据（SQLite/PostgreSQL 等） |
| **API 接口** | 提供至少一个可查询的 HTTP API 端点 |
| **前端展示** | 提供可视化界面展示数据（Web/CLI 皆可） |

### 创新加分项（非必须，但影响评奖等级）

- 实时数据同步（WebSocket 或轮询）
- 独特的分析视角或算法
- 良好的用户体验设计
- 支持多个市场或事件
- 性能优化（大规模数据处理）
- 开源并有良好的代码质量

---

## 提交规范

### 提交内容清单

参赛者需提交以下内容（打包为 zip 或提供 Git 仓库链接）：

```
submission/
├── README.md              # 必须：项目说明文档
├── DEMO.md                # 必须：演示说明和截图
├── src/                   # 必须：源代码目录
├── requirements.txt       # 必须：依赖列表（Python）或 package.json（Node.js）
├── .env.example           # 必须：环境变量示例
├── data/                  # 可选：示例数据或 fixtures
├── screenshots/           # 推荐：运行截图
└── video/                 # 可选：演示视频（< 5 分钟）
```

### README.md 必须包含

```markdown
# 项目名称

## 项目简介
一句话描述项目做什么。

## 技术架构
简要说明技术栈和系统架构。

## 快速开始

### 环境要求
- 有效的 Polygon RPC URL

### 安装步骤
1. 克隆仓库
2. 安装依赖
3. 配置环境变量
4. 运行项目

### 运行命令
具体的启动命令。

## 功能说明
列出主要功能点。

## 数据来源
说明使用的链上数据来源和获取方式。

## 团队成员
列出团队成员（可选）。
```

### DEMO.md 必须包含

```markdown
# 演示说明

## 演示步骤
1. 步骤一
2. 步骤二
...

## 预期输出
描述运行后应该看到什么。

## 截图
![功能截图](screenshots/demo.png)

## 演示数据
使用的示例市场/交易哈希：
- Market: `will-there-be-another-us-government-shutdown-by-january-31`
- Tx: `0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946`
```

---

## 评审验证流程

评审将按以下流程验证提交作品：

### Step 1: 环境搭建
```bash
# 克隆/解压项目
cd submission/

# 安装依赖
pip install -r requirements.txt  # 或 npm install

# 配置环境
cp .env.example .env
# 填入 RPC_URL
```

### Step 2: 基础功能验证
```bash
# 运行主程序
python -m src.main  # 或项目指定的启动命令

# 验证输出
# 检查是否能正确获取和解码链上数据
```

### Step 3: 数据验证
```bash
# 验证数据来源真实性
# 使用示例交易哈希验证解码结果
# 对比 Polygonscan 确认数据正确性
```

### Step 4: 功能完整性检查
- 按 DEMO.md 步骤操作
- 验证所有声称的功能
- 检查 API 端点响应

---

## 评分标准

| 维度 | 权重 | 说明 |
|------|------|------|
| **技术实现** | 30% | 代码质量、架构设计、链上数据处理的正确性 |
| **创新性** | 25% | 想法的独特性、解决问题的新颖程度 |
| **实用价值** | 25% | 项目的实际用途、对 Polymarket 生态的贡献 |
| **完整度** | 15% | 功能完整性、文档质量、演示效果 |
| **代码规范** | 5% | 代码风格、注释、可维护性 |

---

## 常见问题

### Q: 可以使用 Gamma API 吗？
A: 可以，但必须同时使用链上数据。Gamma API 可用于获取市场元数据（如 slug、描述），但交易数据必须从链上获取。

### Q: 可以使用现成的索引服务（如 The Graph）吗？
A: 可以，但需要展示对链上数据结构的理解。如果使用第三方索引服务，需要在文档中说明，并额外提供至少一个自己实现的解码功能。

### Q: 数据需要实时吗？
A: 不强制要求实时。历史数据分析也是有效的项目方向。但如果声称是"实时"功能，评审会验证实时性。

### Q: 可以团队参赛吗？
A: 可以，团队规模不限。请在 README 中列出所有成员。

### Q: 编程语言有限制吗？
A: 不限语言。Python、JavaScript/TypeScript、Rust、Go 等均可。但需要提供清晰的运行说明。

---

## 示例项目：最小可行产品 (MVP)

以下是一个满足最低获奖要求的示例项目结构：

### 项目：Polymarket 大单监控器

**功能**：监控并展示 Polymarket 上的大额交易（>$1000）

**技术栈**：Python + SQLite + Flask

**目录结构**：
```
whale-watcher/
├── README.md
├── DEMO.md
├── requirements.txt
├── .env.example
├── src/
│   ├── __init__.py
│   ├── indexer.py      # 链上数据索引
│   ├── decoder.py      # 交易解码（复用 Stage 1）
│   ├── db.py           # 数据库操作
│   ├── api.py          # Flask API
│   └── main.py         # 入口
├── data/
│   └── whales.db       # SQLite 数据库
└── screenshots/
    └── demo.png
```

**核心功能**：
1. 扫描链上 `OrderFilled` 事件
2. 过滤出成交金额 > $1000 的大单
3. 存入数据库并关联市场信息
4. 提供 API 查询最近的大单列表
5. 简单的 CLI 或 Web 展示

**验证命令**：
```bash
# 运行索引器
python -m src.main index --from-block 66000000 --to-block 66010000

# 启动 API
python -m src.main serve

# 查询大单
curl http://localhost:8000/whales?limit=10
```

---

## 资源链接

- Polymarket 官方文档：https://docs.polymarket.com/
- Gamma API：https://gamma-api.polymarket.com/
- Polygon RPC（免费）：https://polygon-rpc.com/
- 示例交易哈希：`0x916cad96dd5c219997638133512fd17fe7c1ce72b830157e4fd5323cf4f19946`
- 示例市场 Slug：`will-there-be-another-us-government-shutdown-by-january-31`

