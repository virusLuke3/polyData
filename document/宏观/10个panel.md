# CPI Macro Registry Panels for Polymarket

这份文档定义 polyData 后续 CPI / inflation / Fed 相关宏观 panel 的新版方案。

核心调整：**不再继续拆成 10 个小 panel**。CPI 是一个重要领域，但如果拆得过细，每个 panel 只能显示 3-5 条 series，视觉和信息密度都会退化成单薄指标卡。因此新版改为 **5 个高密度 registry panel**：把相关、重复、同一交易问题下的数据源合并到一个 panel 内部，用多源 registry / event log / component table 的方式呈现。

这些 panel 的目标不是复制 Polymarket market 数据。当前 Polymarket market 数据本来存在数据库里，只是因为硬盘空间问题暂时停掉，所以 runtime 设计不能依赖 market DB。Polymarket 在这里的角色是 **需求参考**：参考 Polymarket 上真实存在的 CPI、Fed、unemployment、gas prices、recession 等宏观市场，反推出哪些官方/公开宏观数据源值得追踪。

```text
Polymarket 上真实交易的问题
  -> 反推宏观数据需求
  -> 官方/公开数据源 seed prewarm
  -> CPI registry panel
  -> 帮助用户形成下注判断
```

注意：这些 panel 只帮助形成交易判断，不是投资建议。真正下注前仍然需要检查对应 Polymarket 市场的 resolution source、时间窗口、阈值、seasonally adjusted 口径、初值/修正值等细节。

---

## 1. 新版设计原则

### 1.1 不把 Polymarket Market Rows 加进 Panel

新版 panel 不直接展示 Polymarket market 数据，不依赖 Gamma/CLOB/本地 market DB。

原因：

```text
1. 当前 market DB 暂停，runtime 不能依赖它。
2. CPI panel 的核心价值应该是官方/公开宏观证据，而不是重复 Polymarket 页面。
3. Polymarket 只用于决定“哪些宏观数据值得追踪”。
```

也就是说，panel 内部显示的是 BLS、BEA、FRED、EIA、Fed、Treasury、Federal Register 等公开数据，而不是 Polymarket market list。

### 1.2 从 10 个小 Panel 合并为 5 个 Registry Panel

旧版本的问题：

```text
energy / food / shelter / labor / growth / rates / nowcast / calendar 被拆得过细
每个 panel 只有少量指标
视觉上只能做成几张卡片
无法接近 WorldMonitor 的 registry 密度
```

新版合并标准：

```text
一个 panel = 一个可下注宏观判断问题
一个 panel 内 = 多个数据源共同回答这个问题
```

### 1.3 Registry 优先于 KPI Card

WorldMonitor 的优势不是颜色多，而是它把 panel 做成：

```text
asset registry
event log
status atlas
component table
source health board
```

CPI macro panel 也应该采用类似结构：

```text
HEADER                panel name / source badge / row count
SIGNAL STRIP          current headline signal / freshness / confidence
FILTER CHIPS          hot / cool / watch / official / proxy / component
REGISTRY ROWS         each row = one data series, component, release, or event
SOURCE HEALTH         source-level ok / stale / degraded / optional
```

每行数据都要有明确含义：

```text
component / category
latest value
delta: MoM / WoW / YoY / release-to-release
source
freshness
inflation implication: hot / cool / watch
```

---

## 2. 推荐的 5 个 CPI Macro Registry Panels

```text
1. CPI Release Command Center
2. CPI Components Pressure Registry
3. Goods / Tariff / Supply Chain Watch
4. Labor / Services Inflation Monitor
5. Fed Reaction / Growth Risk Board
```

这 5 个 panel 覆盖 CPI 下注判断的完整链路：

```text
release timing / nowcast
  -> CPI components: energy, food, shelter, goods, services
  -> upstream goods / tariff / supply pressure
  -> labor / wage / services inflation
  -> Fed reaction / growth risk
```

---

## 3. Panel 1: CPI Release Command Center

### 3.1 交易问题

```text
下一次 CPI / PCE release 还有多久？
官方日历是否可靠？
nowcast 是否提示 headline/core 偏热或偏冷？
当前 inflation print 判断应该看哪些阈值？
```

### 3.2 合并来源

```text
cpi-release-calendar
inflation-nowcast
```

### 3.3 数据源

| 数据源 | 类型 | 免费性 | 用途 |
|---|---|---|---|
| BLS CPI release calendar | official | 免费 | CPI 发布时间、release event |
| BEA PCE release calendar | official | 免费 | PCE / Core PCE 发布时间 |
| Fed / FOMC calendar | official | 免费 | CPI 之后的 Fed reaction window |
| Cleveland Fed Inflation Nowcasting | model / official-ish | 免费 | CPI / PCE nowcast |
| FRED CPI / Core CPI / PCE / Core PCE history | official mirror | 免费 | 历史 release、MoM/YoY bridge |
| optional consensus source | optional | 可能付费 | 市场一致预期；缺失时显示 unavailable |

### 3.4 Registry Rows

```text
release row       CPI / Core CPI / PCE / Core PCE / FOMC
nowcast row       Cleveland Fed CPI / Core CPI / PCE / Core PCE
history row       last release MoM / YoY / revision
threshold row     common bucket: 0.2 / 0.3 / 0.4 MoM
source row        BLS / BEA / Fed source health
```

### 3.5 前端结构

```text
CPI RELEASE COMMAND        OFFICIAL / MODEL        24

[signal strip]
NEXT CPI 6H / NOWCAST WATCH / SOURCE OK

chips: CPI / CORE / PCE / FED / HISTORY / SOURCE

registry:
  CAL  CPI Release             May 12 08:30      6H      official
  CAL  PCE Release             May 29 08:30      17D     official
  MOD  Cleveland CPI MoM       0.34              HOT     model
  MOD  Cleveland Core CPI      0.28              WATCH   model
  HIS  Last CPI headline YoY   3.4%              +0.1pp  BLS/FRED
```

### 3.6 成功标准

```text
MVP: 10+ rows
目标: 20-30 rows
必须 seed-first；API 不 live-build
```

---

## 4. Panel 2: CPI Components Pressure Registry

### 4.1 交易问题

```text
这次 CPI 是 headline 热，还是 core sticky？
energy / food / shelter / used cars / medical / transport 哪些分项在推升 CPI？
分项压力是否已经从高频 proxy 传导到官方 CPI 分项？
```

### 4.2 合并来源

```text
energy-gasoline-shock
food-retail-basket-pressure
shelter-rent-oer-pressure
部分 inflation-nowcast driver rows
```

### 4.3 数据源

| 数据源 | 类型 | 免费性 | 用途 |
|---|---|---|---|
| FRED CPI component series | official mirror | 免费 | CPI food/energy/shelter/core components |
| BLS CPI public data | official | 免费 | 官方 CPI 分项口径 |
| EIA gasoline / diesel / WTI / inventory | official | 免费 | energy CPI leading proxy |
| FRED gasoline / fuel oil / utility gas CPI | official mirror | 免费 | energy CPI history |
| FRED food-at-home / food-away / major food groups | official mirror | 免费 | food CPI 分项 |
| FRED rent / OER / shelter | official mirror | 免费 | shelter CPI 分项 |
| Case-Shiller / FHFA house price | public | 免费 | shelter lag proxy |
| Zillow / Redfin rent proxy | optional | 免费/需确认 | leading shelter proxy |

### 4.4 Registry Rows

```text
component row      food, energy, shelter, used cars, medical, transport
proxy row          gasoline, diesel, WTI, rent proxy, home price index
pressure row       hot / cool / watch ranked by latest MoM or weekly move
source row         source freshness and coverage
```

### 4.5 前端结构

```text
CPI COMPONENTS PRESSURE       BLS / EIA / FRED       42

[signal strip]
HEADLINE HOT / CORE STICKY / ENERGY CONTRIBUTION HIGH

chips: ENERGY / FOOD / SHELTER / GOODS / SERVICES / HOT / COOL

registry:
  OIL  WTI crude                 109.76        +9.87w      hot
  GAS  US gasoline               4.581         +0.32w      hot
  OER  Owners equivalent rent    442.7         +0.19%      sticky
  FD   Food at home              310.2         +0.14%      watch
  CAR  Used cars CPI             184.8         -0.80%      cool
```

### 4.6 成功标准

```text
MVP: 20+ rows
目标: 40-60 rows
这是最应该向 WorldMonitor 靠齐的核心 CPI registry panel
```

---

## 5. Panel 3: Goods / Tariff / Supply Chain Watch

### 5.1 交易问题

```text
goods inflation 是否重新升温？
tariff / import cost / upstream PPI 是否会影响下一轮 CPI？
供应链压力是短期事件，还是已经反映到 import/PPI？
```

### 5.2 合并来源

```text
supply-tariff-import-watch
部分 growth-demand 中的 trade / goods data
```

### 5.3 数据源

| 数据源 | 类型 | 免费性 | 用途 |
|---|---|---|---|
| FRED PPI series | official mirror | 免费 | upstream goods pressure |
| FRED import/export price indexes | official mirror | 免费 | import cost pressure |
| BLS import/export price public data | official | 免费 | 官方 import price details |
| Federal Register documents | official | 免费 | tariff / import duty / trade policy events |
| USTR notices | official | 免费 | tariff and trade policy actions |
| Census trade data | official | 免费 | goods import/export flow |
| NY Fed GSCPI | official/public | 免费 | global supply chain pressure |
| Treasury customs duties / receipts | official | 免费 | tariff revenue proxy |

### 5.4 Registry Rows

```text
price row          PPI / import price / export price / durable goods
policy event row   Federal Register / USTR notices
trade row          Census import/export flow
supply proxy row   GSCPI / shipping proxy if available
```

### 5.5 前端结构

```text
GOODS / TARIFF WATCH        PUBLIC / OFFICIAL        36

[signal strip]
GOODS CPI EASING / TARIFF EVENT WATCH

chips: PPI / IMPORT / TARIFF / TRADE / SUPPLY / EVENT

registry:
  PPI  Producer prices all commodities     274.1      +1.78%   hot
  IMP  Import price index                  142.8      +0.30%   watch
  FR   Tariff notice                       May 10     2D ago   event
  USTR China tariff action                 May 08     watch    policy
  GSC  Supply chain pressure               -0.18      cool     proxy
```

### 5.6 成功标准

```text
MVP: 15+ rows
目标: 30-45 rows
必须区分 price signal 和 policy event，不要混成一堆文字
```

---

## 6. Panel 4: Labor / Services Inflation Monitor

### 6.1 交易问题

```text
services inflation 是否仍然 sticky？
wage pressure 是否会让 Fed 反应偏 hawkish？
劳动力市场是 cooling，还是仍然太强？
```

### 6.2 合并来源

```text
labor-wage-services-pressure
部分 fed-rates-polymarket-gap
部分 CPI services component rows
```

### 6.3 数据源

| 数据源 | 类型 | 免费性 | 用途 |
|---|---|---|---|
| BLS payrolls / unemployment / AHE | official | 免费 | labor release core |
| FRED labor series | official mirror | 免费 | seed-friendly series source |
| DOL initial / continuing claims | official | 免费 | high-frequency labor cooling proxy |
| JOLTS job openings / quits | official | 免费 | labor tightness |
| ECI employment cost index | official | 免费 | wage pressure, slower but important |
| CPI services less energy services | official mirror | 免费 | services inflation bridge |
| Atlanta Fed wage tracker | public | 免费/需确认 | wage pressure proxy |

### 6.4 Registry Rows

```text
release row        NFP / unemployment / AHE / ECI / JOLTS
weekly row         initial claims / continuing claims
services row       services CPI / medical services / transport services
bridge row         wage pressure -> services CPI -> Fed implication
```

### 6.5 前端结构

```text
LABOR / SERVICES INFLATION       BLS / DOL       34

[signal strip]
LABOR MIXED / SERVICES STICKY / FED WATCH

chips: JOBS / WAGES / CLAIMS / SERVICES / HOT / COOL

registry:
  JOB  Nonfarm payrolls          158.7K      +115K     hot
  UNE  Unemployment rate         3.9%        +0.1pp    cool
  WAG  Avg hourly earnings       35.1        +0.3%     watch
  CLM  Initial claims            224K        +8K       cool
  SRV  Services CPI less energy  412.2       +0.4%     hot
```

### 6.6 成功标准

```text
MVP: 15+ rows
目标: 30-45 rows
必须把 labor data 和 services CPI bridge 放在同一个 panel，避免用户来回跳
```

---

## 7. Panel 5: Fed Reaction / Growth Risk Board

### 7.1 交易问题

```text
如果 CPI 偏热或偏冷，Fed reaction 会怎么定价？
增长数据是否支持 soft landing、overheating，还是 recession risk？
收益率曲线和前端利率是否已经提前反映？
```

### 7.2 合并来源

```text
fed-rates-polymarket-gap
growth-demand-recession-tracker
部分 cpi-release-calendar 中的 FOMC event rows
```

### 7.3 数据源

| 数据源 | 类型 | 免费性 | 用途 |
|---|---|---|---|
| Fed / FOMC calendar | official | 免费 | Fed reaction window |
| FRED Fed funds / SOFR | official mirror | 免费 | current policy rate |
| Treasury daily yield curve | official | 免费 | 2Y/10Y/rate curve reaction |
| FRED DGS2 / DGS10 / T10Y2Y | official mirror | 免费 | seed-friendly curve data |
| BEA GDP / PCE | official | 免费 | growth and demand |
| Census retail sales | official | 免费 | demand strength |
| Fed industrial production | official | 免费 | output cycle |
| Atlanta Fed GDPNow | public | 免费/需确认 | high-frequency GDP proxy |
| Financial conditions proxy | optional | 免费/需确认 | market stress |

### 7.4 Registry Rows

```text
rate row           Fed funds / SOFR / 2Y / 10Y / curve
calendar row       FOMC meeting / minutes / speech event
growth row         GDP / retail sales / PCE / industrial production
risk row           recession / soft landing / overheating signal
```

### 7.5 前端结构

```text
FED REACTION / GROWTH RISK       FED / TREASURY / BEA       38

[signal strip]
FED GAP WATCH / DEMAND STILL FIRM / CURVE INVERTED

chips: FED / 2Y / 10Y / GDP / RETAIL / RECESSION / EVENT

registry:
  FED  Effective Fed funds        3.63%       +0.00     neutral
  SOF  SOFR                       3.61%       +0.01     watch
  2Y   2Y Treasury                4.22%       +0.08w    hawkish
  RET  Retail sales               752.1K      +1.66%    demand hot
  GDP  Real GDP                   23510B      +0.7%     firm
```

### 7.6 成功标准

```text
MVP: 15+ rows
目标: 30-45 rows
重点不是预测 Fed market，而是解释 CPI 后 Fed/growth narrative 的反应空间
```

---

## 8. 数据源扩展优先级

### 8.1 第一优先级：免费、官方、稳定

```text
BLS
BEA
FRED
EIA
Fed
Treasury
Federal Register
Census
DOL
```

这些源优先进入 seed watcher，因为它们：

```text
免费
无需复杂授权
口径权威
适合缓存
能支持 Polymarket 宏观市场判断
```

### 8.2 第二优先级：免费 proxy / public model

```text
Cleveland Fed Inflation Nowcasting
NY Fed GSCPI
Atlanta Fed GDPNow
FHFA / Case-Shiller
Zillow / Redfin public rent proxy
Atlanta Fed Wage Tracker
```

这些源可以增强前瞻性，但要在 source health 里清楚标注口径和 freshness。

### 8.3 暂不作为 runtime 依赖

```text
Polymarket Gamma / CLOB market rows
本地 market DB
付费 consensus
ACLED 等与 CPI 主线弱相关数据
```

Polymarket 只作为设计参考；如果以后 market DB 恢复，可以在 panel 底部增加 optional linked market strip，但不能让 panel 主数据依赖它。

---

## 9. Seed 架构要求

所有新版 panel 必须使用真正 seed 模式：

```text
watcher / prewarm service 定时拉数据
Redis 存最新 snapshot
SQLite 存 stale fallback
API 只读 seed，不在用户请求中 live-build
前端每个 panel 返回一个就更新一个
当前可见 panel 不走 idle delay
```

推荐 watcher 设计：

```text
macro_cpi_release_command_watcher.py
macro_cpi_components_registry_watcher.py
macro_goods_tariff_supply_watcher.py
macro_labor_services_watcher.py
macro_fed_growth_risk_watcher.py
```

也可以先用一个统一 watcher：

```text
macro_cpi_registry_watcher.py
```

统一 watcher 的优点是共享 FRED/BLS/EIA 请求、减少重复请求和缓存碎片；缺点是某个源失败时需要更细的 per-panel source health。

### 9.1 API 返回字段建议

```json
{
  "panelId": "cpi-components-pressure-registry",
  "generatedAt": "...",
  "status": "ok",
  "cacheMode": "redis-seed",
  "source": "BLS / FRED / EIA",
  "summary": {
    "signal": "HEADLINE HOT / CORE STICKY",
    "hotCount": 12,
    "coolCount": 5,
    "watchCount": 8,
    "sourceCount": 9,
    "coverage": 8,
    "topMover": {}
  },
  "items": [
    {
      "key": "gasoline-eia-weekly",
      "type": "proxy",
      "group": "Energy",
      "label": "US gasoline",
      "value": 4.581,
      "unit": "usd/gal",
      "change": 0.32,
      "changeLabel": "+0.32w",
      "date": "2026-05-04",
      "tone": "hot",
      "source": "EIA",
      "freshness": "24m ago",
      "implication": "headline CPI pressure"
    }
  ],
  "sources": {
    "eia": "ok",
    "fred_cpi_components": "ok",
    "bls_calendar": "ok"
  }
}
```

---

## 10. 前端视觉规范

### 10.1 图标策略

不要使用复杂手绘 SVG 或大方框 icon。当前更适合：

```text
顶部 signal: 细色条 + 文本
行内 marker: 2-3 字母类别码 + 细色条
source/status: badge/chip
```

原因：

```text
这些 panel 是 dense registry，不是插画页面
大 icon 会抢注意力
用户需要扫行、扫数值、扫 delta、扫 source
```

推荐类别码：

| 类别 | marker |
|---|---|
| CPI / inflation | CPI |
| Energy | OIL / GAS |
| Food | FD |
| Shelter / OER | OER |
| Labor | JOB / WAG |
| Fed / rates | FED / 2Y |
| Growth | GDP |
| Policy / tariff | POL |
| Source / official | SRC |

### 10.2 颜色语义

| 语义 | 颜色 |
|---|---|
| inflation hot / hawkish | coral / red |
| inflation cool / dovish | teal / green |
| watch / mixed / event risk | amber |
| official / verified | blue |
| optional / stale / degraded | gray |

不要让颜色成为装饰。每一种颜色都必须对应数据语义。

### 10.3 Row 设计

每个 registry row 推荐固定列：

```text
marker | group + label | value | delta / status
```

移动端可以折行，但不要让文字压在一起。

---

## 11. 开发 Checklist

| 顺序 | 新 panel_id | 来源旧 panel | 状态 | 数据目标 |
|---|---|---|---|---|
| 1 | `cpi-release-command-center` | `cpi-release-calendar`, `inflation-nowcast` | 待重构 | 20-30 rows |
| 2 | `cpi-components-pressure-registry` | `energy-gasoline-shock`, `food-retail-basket-pressure`, `shelter-rent-oer-pressure` | 待重构 | 40-60 rows |
| 3 | `goods-tariff-supply-watch` | `supply-tariff-import-watch` | 待重构 | 30-45 rows |
| 4 | `labor-services-inflation-monitor` | `labor-wage-services-pressure` | 待重构 | 30-45 rows |
| 5 | `fed-reaction-growth-risk-board` | `fed-rates-polymarket-gap`, `growth-demand-recession-tracker` | 待重构 | 30-45 rows |

旧 panel 可以先保留作为兼容层，但新开发应该以这 5 个 panel 为目标。迁移完成后，默认 workspace 应只启用这 5 个 CPI registry panel，而不是 10 个小 panel。

---

## 12. 最终结论

新版 CPI macro panel 的正确方向是：

```text
少做 panel
做厚 panel
用 Polymarket 反推数据需求
runtime 不依赖 Polymarket market DB
官方/公开宏观源 seed-first
每个 panel 做成 registry / event log / component table
```

推荐最终结构：

```text
CPI Release Command Center
CPI Components Pressure Registry
Goods / Tariff / Supply Chain Watch
Labor / Services Inflation Monitor
Fed Reaction / Growth Risk Board
```

这套方案比 10 个小 panel 更适合 CPI 这个领域，也更接近 WorldMonitor 的信息密度：每个 panel 都有明确判断问题、足够多的数据行、颜色语义、source health 和可持续扩展的数据源。
