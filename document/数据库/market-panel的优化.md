你现在频繁点 market 发现各种错误，**核心不是 PostgreSQL 方案本身错了**，而是这套系统已经比 PolyWorld 复杂很多，但测试和数据契约还没有跟上。

准确说，是这几类问题叠加：

1. **数据链路太长**

   现在不是前端直接拿 Gamma 一个 event JSON 就展示，而是：

   ```text
   Gamma / chain
     -> 本机 market/oracle 采集
     -> PostgreSQL core/oracle 表
     -> serving 表
     -> GCP API
     -> 前端 bundle/detail/chart/oracle panel
   ```

   任何一层缺字段、缓存旧、sync 没跑、tunnel 抖动，前端都可能显示异常。

2. **market 有多个 ID，历史上容易错位**

   这是最大的不稳定来源之一：

   - `markets.id`：本地数据库 ID
   - `gamma_market_id`：Polymarket/Gamma market ID
   - `event_id`：Gamma event/group ID
   - `condition_id`
   - `question_id`
   - `yes_token_id / no_token_id`

   你看到的很多“点了 A，显示 B / oracle 对不上 / 价格 100%”问题，本质都是 **selected market、selected outcome、event group、oracle binding 没有统一 contract**。

3. **serving 表不是所有 market 都完整**

   现在 PostgreSQL serving 表能加速查询，但如果某个 market：

   - 没有 `market_chart_serving`
   - 没有 `market_latest_prices`
   - 没有 oracle events
   - 只有 CLOB 盘口，没有历史成交
   - 是新 market，还没被 workspace serving 刷新

   前端就会进入 fallback 状态。之前这些 fallback 没有严格区分“真的没有数据”和“系统没同步到”。

4. **前端 panel 以前是多接口并发拼装**

   一个点击会触发：

   ```text
   detail / price / chart / oracle / lob / content
   ```

   如果这些接口返回时间不同，前端状态就可能短暂错位。比如 price 是新 market，oracle 还是旧 market，chart 是空 snapshot，这就会让你看到“不合理”的组合。

5. **测试设计确实不够系统**

   现在的问题不是没有测试，而是缺少这类测试：

   - 任意 market 点击后，所有 panel 的 `marketId` 必须一致。
   - event group 中每个 outcome 点击后，detail/price/chart/orderbook/oracle 都必须绑定同一个 local market。
   - oracle panel 如果无事件，必须显示“OPEN / no oracle event yet”，不能显示别的 market 的 oracle。
   - chart 没历史时必须显示 snapshot 或明确 missing reason。
   - serving 表缺字段时 API 不能返回半旧半新的 bundle。

   也就是说，缺的是 **market workspace contract test + E2E 随机点击测试**。

6. **PolyWorld 看起来更稳，是因为它更简单**

   PolyWorld 主要直接用 Gamma event JSON。它的优点是：一个 event 里 markets/outcomes/price 都在同一份对象里，前端状态天然一致。

   你的系统更强，但也更容易出错，因为它把数据拆成了数据库、serving、oracle、runtime 多层。强系统需要更强的 contract。

**我的判断**

不是 PostgreSQL 特性导致不可控。
主要是：

```text
数据契约不够硬
+ ID 映射复杂
+ serving 表覆盖不完整
+ 前端状态以前允许错位
+ 缺少随机 market 点击回归测试
```

**应该怎么解决**

下一步不要继续“看到一个修一个”。应该做一个系统性检测器：

```text
scripts/qa/market_workspace_audit.py
```

它随机抽样 100 或 500 个 market，逐个检查：

- `/markets/:id`
- `/markets/:id/detail`
- `/markets/:id/price`
- `/markets/:id/chart`
- `/markets/:id/oracle`
- `/market-groups` 中对应 outcome

然后验证：

```text
所有返回的 localMarketId 一致
gammaMarketId 一致
conditionId/questionId 一致
price 不自相矛盾
chart missing 有明确原因
oracle 绑定不到时不能串到别的 market
serving 表是否缺字段
```

再加一个 Playwright 测试：

```text
随机点击 30 个 market card
截图检查 detail/oracle/chart 是否还是同一个 market
```

这样你以后就不是靠手点发现问题，而是让系统自己告诉你：

```text
market 1718466 failed: chart missing but price exists
market 1722548 failed: oracle bound but condition_id empty
market 1628184 failed: group outcome selectedMarketId mismatch
```

这个才是把项目从“能跑”推进到“可控”的关键。

---

## 对比 PolyWorld 后的重新判断

### PolyWorld 为什么看起来更稳定

PolyWorld 的 market workspace 本质是 **单对象状态模型**。

前端只维护一个核心对象：

```text
selectedMarket: ProcessedMarket
```

这个 `selectedMarket` 里面已经包含：

```text
event id
event slug
event title
markets[]
outcomePrices
clobTokenIds
volume / volume24h
closed / active
endDate
description
```

所以点击任意 market 之后，detail、chart、orderbook、news、tweets 都从同一个 `selectedMarket` 派生数据。

典型链路：

```text
/api/markets
  -> ProcessedMarket[]
  -> useMarketStore.selectedMarket
  -> MarketDetailPanel / ChartPanel / OrderBookPanel
```

例如：

- `MarketDetailPanel` 直接接收 `market={selectedMarket}`。
- `ChartPanel` 通过 `selectedMarket.id` 调 `/api/snapshots?eventId=...`。
- 多 outcome chart 通过 `selectedMarket.markets[]` 找每个 sub-market 的 `clobTokenIds`。
- `OrderBookPanel` 通过 `selectedMarket.markets[]` 枚举 YES/NO token，哪个 token 有盘口就用哪个。
- 切换 market 时，`marketStore.selectMarket()` 会同时清空 `selectedOutcomeTokenId`。

这意味着 PolyWorld 的稳定性不是因为数据更完整，而是因为：

```text
同一个 selectedMarket 对象 = UI 的唯一事实来源
```

即使它没有 oracle、没有 PostgreSQL serving、没有链上绑定，它也很少出现“点 A 显示 B”的状态错位。

### polymonitor 当前的问题是什么

polymonitor 现在不是单对象状态模型，而是 **多状态拼装模型**：

```text
selectedMarketId
selectedMarketGroupId
selectedMarketGroupOutcomeKey
selectedMarketGroupDetail
selectedMarketGroupChart
bundle.market
bundle.price
bundle.chart
bundle.oracle
bundle.lob
selectedMarket
markets[]
marketGroups[]
```

点击一个 market 后，前端会尝试把这些数据拼成一个 workspace。

虽然现在已经加了 `bundleMatchesMarket()`、inflight 去重、bundle cache、serving 表、snapshot cache，但根本问题仍然存在：

```text
没有一个统一的 MarketWorkspace 对象作为唯一事实来源
```

所以会出现这些典型风险：

1. `selectedMarketId` 已经切到新 market，但 `selectedMarketGroupOutcomeKey` 还指向旧 group 的 outcome。
2. `bundle.price` 是当前 market，但 `selectedMarketGroupChart` 是 event group 的旧 chart。
3. `bundle.oracle` 没有事件，前端 fallback 到 global oracle，容易看起来像 oracle 对不上。
4. `marketGroups` 的 outcome price 和 `/markets/:id/price` 不一致时，前端不知道谁更权威。
5. chart、oracle、lob、content 分开请求，任意一个慢返回都可能污染用户感知。
6. serving 表缺字段时，API 会返回“半完整”数据，前端只能猜这是缺数据还是同步失败。

换句话说，当前的主要问题不是 PostgreSQL，也不是 PolyWorld 方案一定更好，而是：

```text
数据层做了 serving 化，但前端状态层还没有 workspace 化。
```

### 现在真正的问题定义

现在 market panel 的不稳定可以归纳为四个问题：

#### 1. 事实来源不唯一

PolyWorld 的事实来源是：

```text
selectedMarket
```

polymonitor 当前的事实来源分散在：

```text
marketGroups
selectedMarket
bundle
selectedMarketGroupDetail
selectedMarketGroupChart
oracle payload
lob runtime
```

这导致任何两个来源不一致时，前端没有严格规则判断谁赢。

#### 2. ID contract 不够硬

一个 market workspace 至少涉及：

```text
local market id
gamma market id
event id
condition id
question id
yes token id
no token id
outcome key
```

现在这些字段虽然都有，但没有被封装成一个不可变的 `identity` contract。
因此每个 panel 都在自己选字段、自己 fallback。

#### 3. API 仍然偏“接口集合”，不是“workspace bundle”

现在已经有 `/markets/:id/detail` 和 workspace bundle 的雏形，但前端仍然会额外拉：

```text
market group detail
market group chart
market chart
lob
content
oracle
```

这比 PolyWorld 更容易出 race condition。
PolyWorld 虽然也有 chart/orderbook 请求，但它们都从同一个 `selectedMarket` 派生，不会改变 market identity。

#### 4. 缺少自动化点击审计

现在主要靠人工点 market 发现问题。
这不适合这个项目，因为 market 类型非常多：

```text
binary
multi-binary event
neg-risk
sports
crypto up/down
closed but unresolved
settled
new market without history
market with CLOB but no local chart
market with oracle binding but no event
```

人工点几个样本无法覆盖这些状态。

---

## 应该做的优化方案

目标不是退回 PolyWorld，而是把 PolyWorld 的稳定设计思想移植到 polymonitor：

```text
用 PostgreSQL serving 做数据底座
用 MarketWorkspace 做前端唯一事实来源
用自动化 audit 保证任意 market 点击不串数据
```

### Phase 1：定义统一 MarketWorkspace contract

新增一个统一类型，前端所有 market/oracle/chart/lob panel 都只读它：

```ts
type MarketWorkspace = {
  identity: {
    localMarketId: number;
    gammaMarketId: string | null;
    eventId: string | null;
    eventSlug: string | null;
    conditionId: string | null;
    questionId: string | null;
    yesTokenId: string | null;
    noTokenId: string | null;
    selectedOutcomeKey: string | null;
  };
  market: MarketSummary;
  group: MarketGroupDetail | null;
  selectedOutcome: MarketGroupOutcome | null;
  price: PriceSummary | null;
  chart: ChartPayload | MarketGroupChartPayload | null;
  oracle: OraclePayload | null;
  lob: LobPayload | null;
  health: {
    priceStatus: "ok" | "missing" | "stale";
    chartStatus: "ok" | "snapshot" | "missing" | "stale";
    oracleStatus: "bound" | "open-no-events" | "unbound" | "mismatch";
    lobStatus: "ok" | "no-book" | "missing";
    servingStatus: "ok" | "partial" | "missing";
  };
};
```

规则：

- UI 不再直接混用 `selectedMarketId + selectedMarketGroupOutcomeKey + bundle + groupDetail`。
- 每次点击 market，先生成一个 `MarketWorkspace`。
- 任何 panel 只允许读 `workspace.identity.localMarketId`。
- 如果某个接口返回的 `marketId` 和 workspace 不一致，直接丢弃，不合并。

### Phase 2：新增 `/markets/:id/workspace` 后端接口

这个接口一次返回当前 market 的完整 workspace：

```text
GET /markets/:id/workspace
```

它在后端完成：

```text
market identity
market summary
event group detail
selected outcome
price
chart snapshot / event chart
oracle summary + timeline
lob summary
diagnostics
```

前端点击 market 后，只先请求这一个接口。
chart / lob / content 可以异步补充，但不能改变 workspace identity。

后端优先读 PostgreSQL serving 表：

```text
core.market_workspace_serving
core.market_chart_serving
core.event_market_serving
core.market_latest_prices
core.market_list_serving
core.market_status_snapshot
oracle.oracle_events
```

Gamma / CLOB 只能作为补充，不作为 workspace 主事实来源。

### Phase 3：把前端状态收敛成一个 workspace reducer

当前前端状态应从：

```text
selectedMarketId
selectedMarketGroupId
selectedMarketGroupOutcomeKey
selectedMarketGroupDetail
selectedMarketGroupChart
bundle
```

逐步收敛成：

```text
workspace: MarketWorkspace | null
workspaceRequestSeq
workspaceCache
```

所有点击操作只做一件事：

```ts
selectMarket(localMarketId)
```

然后 reducer 负责：

```text
设置 optimistic workspace
拉 /markets/:id/workspace
验证 identity
合并补充数据
拒绝旧请求
标记 missing/stale reason
```

### Phase 4：修复 oracle panel 的绑定逻辑

oracle panel 必须只展示当前 workspace 的 oracle，不允许 fallback 到 global oracle 冒充当前 market。

规则：

```text
如果 workspace.oracle.timeline 有事件：显示事件时间线
如果 workspace.oracle bound 但无事件：显示 OPEN / no oracle events yet
如果 condition_id/question_id/oracle 缺失：显示 unbound，列出缺失字段
如果返回的 oracle.marketId != workspace.identity.localMarketId：丢弃并标记 mismatch
```

这可以彻底解决“oracle feed 看起来对应不上”的问题。

### Phase 5：chart 统一来源和降级语义

chart 不应该只是“有线/没线”。必须区分：

```text
ok: 有历史曲线
snapshot: 只有当前价，画水平线
missing-local-history: 本地没有历史
missing-token: 没有 token，无法查 CLOB
stale: 有历史但太旧
pending-sync: 新 market，等待 serving 刷新
```

前端展示时：

- `ok`：画完整 Polymarket 风格概率图。
- `snapshot`：画水平线，并标注 snapshot。
- `missing-local-history`：显示明确原因，不再像加载失败。
- `stale`：保留旧线，但加 stale 标记。

### Phase 6：做系统性 QA，而不是人工点

新增：

```text
scripts/qa/market_workspace_audit.py
```

检查 100/500 个 market：

```text
/markets/:id
/markets/:id/workspace
/markets/:id/detail
/markets/:id/price
/markets/:id/chart
/markets/:id/oracle
/market-groups
```

每个 market 验证：

```text
localMarketId 一致
gammaMarketId 一致
conditionId/questionId 不串
selectedOutcome.marketId == selected market id
price.latestYesPrice 与 group outcome yesPrice 不冲突
chart.marketId 一致
oracle.marketId 一致
oracle 无事件时不 fallback 到 global event
missing/stale 有 reason
```

输出类似：

```text
PASS 1718466 workspace ok
FAIL 1722548 chart missing-local-history but no reason
FAIL 1628184 oracle mismatch: payload marketId=1628176 selected=1628184
```

### Phase 7：做 Playwright 随机点击测试

新增 E2E：

```text
随机点击 30 个 active market cards
随机点击 20 个 newest market cards
随机点击 20 个 event outcome cards
```

浏览器里验证：

```text
detail title 包含当前 market/outcome
oracle panel 的 MKT id 等于当前 market id
chart 不显示旧 market 的线
orderbook header token/outcome 与当前 market 一致
没有无限 loading
没有 global oracle 冒充 focused oracle
```

### Phase 8：把 serving 表刷新纳入健康检查

新增定期 health：

```text
market_workspace_serving coverage
market_chart_serving coverage
event_market_serving coverage
oracle binding coverage
latest price coverage
```

指标示例：

```text
active markets: 80
workspace rows: 80 / 80
chart ok: 42
chart snapshot: 31
chart missing with reason: 7
oracle bound: 80
oracle events: 12
price coverage: 76 / 80
```

这样以后不是靠眼睛看哪里坏，而是系统告诉你哪一层不完整。

---

## 最终结论

现在的问题不是“该不该用 PostgreSQL”，也不是“要不要照搬 PolyWorld”。

真正的问题是：

```text
polymonitor 的数据底座已经升级成数据库/serving 架构，
但前端 workspace 状态模型还停留在多接口拼装阶段。
```

PolyWorld 值得学习的不是它直接拉 Gamma，而是它的状态模型：

```text
一个 selectedMarket 驱动所有 panel
```

polymonitor 下一步应该实现：

```text
一个 MarketWorkspace 驱动所有 panel
```

这样才能同时保留你的 PostgreSQL / oracle / serving 表优势，又避免点击 market 时出现各种不可控错位。

---

## 2026-05-22 实施记录

已经开始按上述方案落地第一层代码：

1. 后端新增 `GET /markets/:id/workspace`。
   - 单次返回 market、identity、health、group、selectedOutcome、price、chart、oracle。
   - `health` 明确输出 price/chart/oracle/group/serving 状态。
   - oracle payload 如果 local market id 不匹配，会标记 `oracleStatus=mismatch`，前端不再把错误 oracle 当作当前 market 展示。

2. 前端 `fetchWorkspaceBundle()` 优先调用 `/markets/:id/workspace`。
   - `/markets/:id/detail` 只作为兼容 fallback。
   - bundle 内新增 `health/group/selectedOutcome`，所有 panel 优先使用同一份 workspace contract。

3. Market Detail / Focused Strip / Oracle Status 的选择逻辑改为：
   - 优先使用 bundle 中 market_id 匹配的 market/group/outcome。
   - oracle panel 只接受 market_id 与当前 selectedMarketId 一致的 oracle payload。
   - 解决之前点击 A market 后 oracle/detail 混入 B market 数据的问题。

4. 新增 `scripts/qa/market_workspace_audit.py`。
   - 可批量抓 active/new/volume market。
   - 自动检查 workspace、oracle、chart 是否全部绑定同一个 market_id。
   - 后续应该把它接入部署后的 GCP smoke test。

已验证：

```text
python -m py_compile 通过
npm run build 通过
Flask test_client /markets/1718466/workspace 返回 200
1718466 / 1722548 workspace 的 selectedOutcome、price、chart、oracle market_id 均一致
1628184 历史 up/down market 能正确返回 oracle bound，但 price/chart 缺失被标记为 warn，而不是串到别的 market
```
