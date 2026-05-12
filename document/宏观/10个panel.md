# CPI Macro Panels for Polymarket

这份文档重新定义一组和 **CPI / inflation / Fed / 宏观预测市场** 相关联的 panel。目标不是做一个普通宏观数据看板，而是做一个给 Polymarket 交易者使用的 **CPI Macro Intelligence Layer**：

```text
上游冲击
  → 价格压力
  → CPI / PCE nowcast
  → Fed reaction
  → Polymarket implied probability
  → gap / signal
```

一个 panel 是否值得做，不只看数据是否宏观相关，还要看它能否帮助用户回答下注前的三个问题：

```text
1. 这个数据会影响哪些 Polymarket 市场？
2. 它是否比市场价格更早变化？
3. 它能否转化成可比较的概率、阈值或方向信号？
```

注意：这些 panel 只能帮助形成交易判断，不是投资建议。真正下注前还必须解析每个 Polymarket 市场的 resolution source、时间窗口、阈值口径、是否 seasonally adjusted、是否取初值或修正值。

---

## 1. 面向 WorldMonitor 级别的 Panel 设计原则

当前 polyData 的 CPI panel 不能只做成黑底白字的指标卡。WorldMonitor 值得借鉴的不是某个具体 UI，而是它把 panel 设计成 **intelligence registry / event log / atlas / market implication layer**：每个 panel 都有实体、事件、状态、证据、严重性、来源健康和可操作结论。

因此后续每个 CPI macro panel 都要同时满足三件事：

```text
1. 数据源不止一个：official baseline + high-frequency proxy + Polymarket market layer
2. 视觉不是装饰：颜色、badge、chip、边框、排序都表达严重性和下注相关性
3. 输出不是指标：必须能回答 driver → CPI/PCE → Fed → PMKT odds 的交易问题
```

### 1.1 Panel 的标准信息结构

每个 panel 都应该从单一数据卡升级为如下结构：

```text
PANEL NAME                 OFFICIAL / MARKET / MODEL / DEGRADED

SUMMARY STRIP              signal / severity / confidence / freshness
DRIVER TILES               top 3-6 drivers, color-coded by direction and strength
EVENT / RELEASE LOG        latest official release, policy event, market move, source update
ENTITY / CATEGORY TABLE    components, regions, assets, markets, or catalysts
PMKT LINKED MARKETS        active markets, midpoint, spread, volume, time to close
GAP / IMPLICATION          model/driver signal vs Polymarket implied probability
SOURCE HEALTH              source-level ok / stale / degraded / paid / optional
```

不要只展示数据。Polymarket 用户需要的是：

| 用户问题 | panel 应该输出 |
|---|---|
| CPI 会不会高于某个 bucket？ | nowcast vs market bucket gap |
| 通胀是 headline 热，还是 core sticky？ | headline-core gap、energy driver、services pressure |
| Fed 市场是否已经 price in？ | Fed implied probability vs CPI/labor/growth signal |
| 市场有没有低估某个事件？ | PMKT price vs external data / model probability |
| 数据是否还能信？ | freshness、source、coverage、staleness |

### 1.2 颜色和视觉语义

颜色必须传递含义，而不是只靠黑白文字：

| 语义 | 建议颜色 | 用法 |
|---|---|---|
| Hot / inflation up / hawkish | red / coral | CPI hot、energy shock、core sticky、Fed hawkish |
| Cool / inflation down / dovish | green / teal | disinflation、growth cooling、Fed cut support |
| Watch / uncertain / mixed | amber / yellow | 数据分歧、事件临近、confidence medium |
| Official / verified | blue | BLS、BEA、Fed、EIA、Treasury、Federal Register |
| Market / Polymarket odds | purple | PMKT price、gap、orderbook、volume |
| Degraded / stale | gray | source stale、fallback、partial coverage |

视觉层级规则：

```text
最强信号 = 最大字号 + 彩色左边框 / 顶边框
最新事件 = 时间 chip + source badge
可交易市场 = purple odds chip + spread/liquidity
异常项 = red/green delta + rank
数据问题 = gray degraded badge，不要和真实信号混在一起
```

每个 panel 至少要有：

```text
severity badge      HOT / COOL / WATCH / NEUTRAL / DEGRADED
source badges       BLS / FRED / EIA / FED / PMKT / FR / TREASURY
trend deltas        1D / 7D / MoM / YoY / release-to-release
ranked rows         top movers / latest events / linked markets
empty-state rule    数据缺失时解释缺哪个 source，而不是只显示 0
```

### 1.3 数据源栈要求

每个 panel 的数据源应该按三层设计：

| 层级 | 作用 | 示例 |
|---|---|---|
| Official baseline | 可信锚点，低频但权威 | BLS, BEA, EIA, Fed, Treasury, Federal Register, FRED |
| High-frequency proxy | 提前反映冲击 | WTI, gasoline, yields, DXY, futures, retail proxy, news/event feeds |
| Polymarket layer | 下注入口和价格校验 | Gamma active events, CLOB midpoint/spread, volume, expiry, resolution source |

如果某个 panel 只有 official baseline，它可以作为一期上线，但必须在文档里标明二期要补 proxy 和 PMKT layer。否则视觉上一定会变成“孤立指标卡”。

### 1.4 合并原则

不要因为 panel 看起来空就机械合并。合并标准应该是：

```text
一个 panel = 一个交易判断问题
一个 panel 内 = 多个数据源共同回答这个问题
```

允许做 composite panel，但它必须回答更高层问题：

| Composite | 包含 | 回答的问题 |
|---|---|---|
| Headline CPI Pressure | energy + food + import/tariff | headline CPI 是否偏热？ |
| Core CPI Pressure | shelter + labor/services | core CPI 是否 sticky？ |
| Macro Gap | nowcast + Fed/rates + PMKT odds | 市场价格是否和宏观数据一致？ |

所以当前 10 个 panel 不应该简单缩成 3 个，但每个 panel 都要从单源指标升级成 multi-source intelligence panel。

---

## 2. 推荐的 10 个 Panel

最终建议的 10 个 panel：

```text
1. Polymarket Macro Market Map
2. CPI Release Calendar & Consensus Baseline
3. Energy & Gasoline Shock
4. Food & Retail Basket Pressure
5. Supply Chain / Tariff / Import Price Watch
6. Shelter / Rent / OER Pressure
7. Labor / Wage / Services Pressure
8. Growth / Demand / Recession Tracker
9. Inflation Nowcast & Official CPI Bridge
10. Fed / Rates & Polymarket Macro Gap
```

### 开发 Checklist

| 顺序 | panel_id | 状态 | 备注 |
|---|---|---|---|
| 1 | `polymarket-macro-map` | 已完成 | Gamma seed-first，已接入 Redis + SQLite snapshot |
| 2 | `cpi-release-calendar` | 已完成 | BLS / BEA / Fed 官方日历 + Polymarket implied baseline；BLS server 403 时使用当前年度官方 schedule fallback |
| 3 | `energy-gasoline-shock` | 已完成 / 待视觉升级 | EIA public XLS seed-first；后续补 PMKT oil/CPI linked markets、inventory/event log、severity colors |
| 4 | `food-retail-basket-pressure` | 已完成 / 待数据源扩展 | FRED/BLS CPI food components seed-first；后续补 retail proxy / commodity proxy / PMKT CPI link |
| 5 | `supply-tariff-import-watch` | 待开发 | Federal Register / Treasury / BLS import prices / GSCPI / PMKT tariff-China markets |
| 6 | `shelter-rent-oer-pressure` | 待开发 | BLS/FRED + Zillow/FHFA/Case-Shiller + PMKT CPI/Fed link |
| 7 | `labor-wage-services-pressure` | 待开发 | BLS/DOL + JOLTS/ECI/claims + PMKT Fed/unemployment/recession link |
| 8 | `growth-demand-recession-tracker` | 待开发 | GDPNow/BEA/Census/Fed + PMKT GDP/recession/Fed link |
| 9 | `inflation-nowcast` | 待升级 | 已有 panel；升级成 Cleveland Fed nowcast + official bridge + PMKT bucket gap |
| 10 | `fed-rates-polymarket-gap` | 待开发 | Fed/rates/yields + PMKT Fed/CPI/recession gap layer |

这条链路比原来的版本更贴近 CPI：

```text
PMKT markets
  → release calendar
  → energy / food / supply / shelter / wages / demand
  → CPI nowcast
  → Fed reaction
  → PMKT gap
```

原文里的 `Fiscal / Shutdown` 和 `Market Risk Reaction` 不是没价值，而是更适合二期。它们对宏观情绪和政治市场有用，但不是 CPI 主链路。

---

## 3. 10 个 Panel 的 WorldMonitor 级升级矩阵

这一节是后续开发的硬标准。每个 panel 都要有 `source stack`、`visual structure`、`PMKT use case`，否则容易退化成单调的黑白指标卡。

| Panel | 交易问题 | 数据源栈 | 视觉结构 | 颜色重点 |
|---|---|---|---|---|
| `polymarket-macro-map` | 当前有哪些可下注宏观市场？ | Gamma events/markets + CLOB price/spread/volume + macro category classifier | market cluster registry、top catalyst、category heat tiles、active market rows | purple=PMKT, amber=event risk, red/green=odds move |
| `cpi-release-calendar` | 离 release 多近，市场基准是多少？ | BLS/BEA/Fed calendars + PMKT CPI baseline + optional consensus | event timeline、countdown tiles、official source badges、baseline/gap strip | blue=official, amber=event risk, purple=PMKT baseline |
| `energy-gasoline-shock` | headline CPI 是否被 energy 推热？ | EIA WTI/gas/diesel/inventory + FRED/market oil proxy + PMKT oil/CPI markets | energy driver tiles、inventory/event log、linked market rows、CPI impulse bar | red=energy inflation impulse, green=headline cooling |
| `food-retail-basket-pressure` | food-at-home 是否出现压力？ | FRED/BLS CPI food components + commodity/retail proxy + optional retailer basket + PMKT CPI markets | category movers、component table、coverage/freshness、top mover strip | red=food pressure, green=food disinflation, gray=retail proxy missing |
| `supply-tariff-import-watch` | goods inflation / tariff narrative 是否升温？ | Federal Register + USTR + Treasury customs revenue + BLS import prices + GSCPI + PMKT tariff/China markets | policy event log、import price tiles、tariff action registry、linked markets | red=tariff/goods pressure, blue=official notice, purple=PMKT trade markets |
| `shelter-rent-oer-pressure` | core CPI 是否 sticky？ | BLS/FRED rent/OER + Zillow rent + FHFA/Case-Shiller + PMKT CPI/Fed markets | lag bridge chart、rent/OER tiles、leading indicator rows、core CPI implication | red=core sticky, green=shelter cooling, amber=lag uncertainty |
| `labor-wage-services-pressure` | services inflation 和 Fed 反应是否偏 hawkish？ | BLS jobs/AHE/JOLTS/ECI + DOL claims + PMKT Fed/unemployment markets | labor heat grid、claims trend、wage/services strip、Fed implication rows | red=hawkish wage pressure, green=labor cooling, amber=mixed labor |
| `growth-demand-recession-tracker` | demand 是否支撑 inflation，recession odds 是否错价？ | Atlanta Fed GDPNow + BEA + Census retail sales + Fed industrial production + PMKT GDP/recession markets | demand tiles、recession score, release log、market gap rows | green=soft landing, red=overheating, amber=slowdown |
| `inflation-nowcast` | CPI/PCE bucket 是否和 nowcast 一致？ | Cleveland Fed nowcast + BLS/BEA official history + energy/food/shelter drivers + PMKT bucket markets | nowcast bridge table、threshold ladder、driver contribution strip、PMKT gap | red=hot bucket, green=cool bucket, purple=mispricing |
| `fed-rates-polymarket-gap` | Fed/Rates 市场是否和宏观信号一致？ | Fed calendar/H.15/SOFR/FRED yields + PMKT Fed markets + CPI/labor/growth signals | rates curve tiles、Fed meeting ladder、macro-vs-PMKT gap registry | purple=PMKT gap, red=hawkish, green=dovish |

### 3.1 每个 Panel 的最低数据源数量

| 状态 | 要求 |
|---|---|
| 可上线 MVP | 至少 1 个 official source + seed cache + source health + clear empty/degraded state |
| 可作为交易 panel | 至少 1 个 official source + 1 个 proxy source + 1 个 PMKT linked market layer |
| WorldMonitor 级别 | official + proxy + PMKT + event log + source health + severity colors + screenshot QA |

已经完成的前 4 个 panel 可以先保留当前 MVP，但后续要按这个矩阵逐个视觉和数据源升级。

### 3.2 10 个 Panel 的前端视觉单独分析

这一节只讨论前端呈现。目标不是把 panel 做得更花，而是让用户一眼抓住：

```text
这是什么信号？
严重不严重？
来源可信吗？
和哪个 Polymarket 市场有关？
下一步应该点哪里看细节？
```

WorldMonitor 的核心经验是：**小字号 mono 体系 + 暗底细边框 + 行级语义 icon + 右侧状态 badge + 表格化 registry + 少量职责明确的颜色**。下面 10 个 panel 都应遵守固定 panel 尺寸，不允许为了内容多就改成 tall / wide；新增信息优先通过内部滚动、表格列、drawer 和分组 chip 解决。

#### 3.2.1 `polymarket-macro-map`

前端定位：宏观市场路由器，不是指标面板。它应该像 WorldMonitor 的 registry 一样，让用户快速扫到当前有哪些可交易主题。

推荐布局：

```text
HEADER: PMKT MACRO MAP        ?   LIVE   17

[radar icon tile] SIGNAL
                  ENERGY / FED CLUSTER ACTIVE
                  PMKT ROUTE / 17 ACTIVE

chips: CPI / FED / ENERGY / LABOR / GROWTH

registry rows:
  icon  market title / category        vol / close      odds badge
  icon  top catalyst                   time-to-event    move badge
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | title 11px uppercase；row title 11-12px semibold；meta 9px uppercase dim |
| icon | 使用 macro radar / market route / category glyph；每一行都要有 category icon |
| 颜色 | purple 只给 PMKT odds / market gap；amber 给 event risk；red/green 给 odds move |
| 边框 | hero signal 用一条左侧蓝紫色边框；market rows 用极淡分割线 |
| 分布 | 上方一条 signal strip，下方是 registry table；不要堆 4 个大 KPI 卡片 |
| 重点 | 右侧固定放 odds / volume / time-to-close，用户扫右列即可判断下注价值 |

#### 3.2.2 `cpi-release-calendar`

前端定位：事件时钟 + 官方 release registry。它应该参考 WorldMonitor 的 Economic Calendar，而不是普通日期卡片。

推荐布局：

```text
HEADER: CPI CALENDAR          ?   OFFICIAL   8

[calendar icon tile] EVENT RISK HIGH
                     NEXT CPI / 12H / PMKT BASELINE 0.34

tabs/chips: CPI / PCE / NFP / FOMC

timeline table:
  flag/source icon  event name          date/time       impact dot
  PMKT icon         linked market       baseline        odds badge
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | 日期数字可稍大 13-14px；event title 11-12px；source/meta 9px |
| icon | calendar、BLS、BEA、Fed source mark；行首可用 official source glyph |
| 颜色 | blue=official source；amber=event risk / imminent；purple=PMKT baseline |
| 边框 | timeline 行只用底部分割线；即将发生事件左侧加 amber accent border |
| 分布 | 不要四个大日期卡片平铺；改成 timeline registry，日期列固定靠右 |
| 重点 | countdown / impact dot / PMKT baseline 必须在稳定位置出现 |

#### 3.2.3 `energy-gasoline-shock`

前端定位：headline CPI energy driver，不是 EIA 数据表。它应该像 Fuel Prices + Energy Disruptions 的混合体。

推荐布局：

```text
HEADER: ENERGY / GAS          ?   EIA   5

[oil drop icon tile] HEADLINE CPI HOTTER
                     EIA PETROLEUM STACK / CPI IMPULSE +0.035PP

driver rows:
  oil icon       WTI crude        109.76      +9.87W badge
  gas pump icon  US gasoline      4.581       +0.32W badge
  diesel icon    US diesel        5.640       +0.29W badge

event/source log:
  source badge   EIA PUBLIC XLS / DAILY       fresh badge
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | 价格使用 tabular nums 16-18px；商品名 11px；来源 9px uppercase |
| icon | oil drop、gas pump、diesel / barrel；每个能源品种必须有独立 glyph |
| 颜色 | coral/red=headline inflation impulse；green=energy cooling；blue=EIA official |
| 边框 | hero strip 左侧使用 energy coral border；行分割保持很淡 |
| 分布 | 第一屏显示 3-5 个关键能源 driver，不要把全部描述塞进 hero |
| 重点 | CPI impulse 和 weekly delta 是重点，不能藏在副标题里 |

#### 3.2.4 `food-retail-basket-pressure`

前端定位：food CPI component pressure。它应该参考 WorldMonitor Consumer Prices 的 overview / categories / movers / health，但保持固定 panel 高度。

推荐布局：

```text
HEADER: FOOD / RETAIL         ?   FRED/BLS   5

[basket icon tile] FOOD PRESSURE STABLE
                   OFFICIAL FOOD CPI COMPONENTS / COVERAGE 5/5

tabs/chips: overview / movers / health

mover rows:
  food icon      eggs / meat / fruit       MoM badge       YoY
  source icon    FRED/BLS series           fresh badge     updated
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | component name 11px；MoM/YoY 数值 tabular nums；source 9px dim |
| icon | basket、egg/meat/fruit/grain 等 component glyph；source health glyph |
| 颜色 | red=food pressure；green=disinflation；gray=retail proxy missing/stale |
| 边框 | category mover 行使用细分割线；coverage / freshness 用小 badge，不用大卡片 |
| 分布 | top movers 比 summary 更重要；summary 放 hero，列表承载细节 |
| 重点 | 明确 official layer 和 retail proxy layer，不能让用户误以为零售 proxy 等于 CPI |

#### 3.2.5 `supply-tariff-import-watch`

前端定位：policy event log + goods inflation pass-through。它应该像 Global Fuel Shortage Registry：事件、来源、证据、严重性一行扫完。

推荐布局：

```text
HEADER: SUPPLY / TARIFF       ?   POLICY   9

[tariff icon tile] GOODS PRESSURE RISING
                   FR / USTR / IMPORT PRICE LINKED

filter chips: tariff / import prices / supply / China

event registry:
  policy icon    Section 301 notice        date       severity chip
  import icon    import price MoM          value      pressure badge
  PMKT icon      tariff market             odds       gap badge
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | event title 11px semibold；legal/source meta 9px uppercase |
| icon | tariff shield、ship/container、Federal Register/source mark、PMKT mark |
| 颜色 | red=tariff/goods pressure；blue=official notice；purple=PMKT trade market |
| 边框 | policy events 用左侧 red/amber border 表达 severity |
| 分布 | 不要只列新闻标题；必须有 event type、source、date、severity 列 |
| 重点 | policy action 和 price pass-through 是两条不同视觉轨道 |

#### 3.2.6 `shelter-rent-oer-pressure`

前端定位：core CPI sticky detector。它不应该做成 housing 数据卡，而应该突出 official CPI shelter 与 leading rent 的滞后桥。

推荐布局：

```text
HEADER: SHELTER / RENT        ?   OFFICIAL+LEAD   6

[home icon tile] CORE STICKY
                 OER / RENT LAG BRIDGE / LEADING RENT COOLING

bridge rows:
  official icon   OER / rent CPI        YoY / MoM       sticky badge
  leading icon    Zillow / FHFA         latest          lead badge
  PMKT icon       core CPI / Fed link   odds            gap badge
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | OER/Rent 数值 15-16px；bridge label 9px uppercase |
| icon | house、rent receipt、lag arrow、official/leading source mark |
| 颜色 | red=core sticky；green=shelter cooling；amber=lag uncertainty |
| 边框 | official data 与 leading proxy 使用不同左边框颜色，避免混淆口径 |
| 分布 | 做成 lag bridge list，而不是 metric grid；每行说明 official/proxy |
| 重点 | `official CPI shelter` 和 `leading rent proxy` 必须视觉分层 |

#### 3.2.7 `labor-wage-services-pressure`

前端定位：services inflation + Fed reaction pressure。它应该像 compact status matrix，而不是就业数据汇总。

推荐布局：

```text
HEADER: LABOR / WAGES         ?   BLS/DOL   7

[labor icon tile] FED HAWKISH
                  WAGE / SERVICES PRESSURE ACTIVE

matrix rows:
  payroll icon   NFP              actual / trend      strength badge
  wage icon      AHE / ECI         MoM/QoQ             sticky badge
  claims icon    initial claims    level / delta       cooling badge
  PMKT icon      Fed / unemployment market             odds gap
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | key labor prints 13-15px tabular nums；row meta 9px |
| icon | worker/payroll、wage, claims, services, Fed |
| 颜色 | red=hawkish wage pressure；green=labor cooling；amber=mixed |
| 边框 | wage/services rows 可用 red accent，claims cooling 用 green accent |
| 分布 | 使用两列 compact matrix 或 table；不要做大段解释文字 |
| 重点 | 输出 `services sticky` / `Fed hawkish`，不是只报 NFP 数字 |

#### 3.2.8 `growth-demand-recession-tracker`

前端定位：demand pressure and recession odds validator。它应该把 growth 数据翻译成 soft landing / slowdown / overheating。

推荐布局：

```text
HEADER: GROWTH / DEMAND       ?   NOWCAST   6

[pulse icon tile] SOFT LANDING
                  GDPNow / RETAIL SALES / RECESSION SCORE

demand registry:
  GDP icon       GDPNow            SAAR       revision badge
  retail icon    retail sales      MoM        demand badge
  factory icon   industrial prod   MoM        slowdown badge
  PMKT icon      recession/GDP     odds       gap badge
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | GDPNow/recession score 15-16px；component rows 11px |
| icon | GDP pulse, retail cart, factory, recession warning, PMKT |
| 颜色 | green=soft landing；red=overheating；amber=slowdown/mixed；purple=PMKT odds |
| 边框 | signal strip 用 green/amber/red 随状态变化 |
| 分布 | score + registry，不要只做 GDPNow 一个大数字 |
| 重点 | 让用户知道这个 panel 主要影响 recession/GDP/Fed，不是直接预测 CPI bucket |

#### 3.2.9 `inflation-nowcast`

前端定位：CPI/PCE bucket bridge。它是整条链的核心，必须最像 trading terminal。

推荐布局：

```text
HEADER: INFLATION NOWCAST     ?   FED/MODEL   8

[gauge icon tile] HOT HEADLINE / CORE STABLE
                  UPDATED / NEXT CPI / CONFIDENCE

threshold ladder:
  CPI MoM       nowcast       PMKT threshold       gap badge
  Core CPI      nowcast       PMKT threshold       gap badge
  PCE           nowcast       PMKT threshold       gap badge

driver strip:
  energy / food / shelter / labor contribution chips
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | nowcast values 16-18px tabular nums；threshold labels 9px uppercase |
| icon | gauge / thermometer、headline/core split、PMKT bucket mark |
| 颜色 | red=hot bucket；green=cool bucket；purple=market gap；blue=model/source |
| 边框 | threshold rows 用 left border 表示 hot/cool；PMKT gap 用 purple chip |
| 分布 | 不要普通 KPI grid；用 threshold ladder 显示 “是否跨 bucket” |
| 重点 | `nowcast vs PMKT threshold` 必须是第一屏焦点 |

#### 3.2.10 `fed-rates-polymarket-gap`

前端定位：macro signal vs Polymarket price gap。它应该像 market discrepancy registry，而不是 rates quote 面板。

推荐布局：

```text
HEADER: FED / PMKT GAP        ?   MARKET   10

[Fed icon tile] FED CUT RICH
                MACRO SIGNAL VS PMKT ODDS

gap registry:
  Fed icon      June decision      PMKT odds      model signal      gap badge
  CPI icon      hot CPI bucket     PMKT odds      nowcast           gap badge
  growth icon   recession market   PMKT odds      growth score      gap badge

rates strip:
  2Y / 10Y / curve / SOFR small quote row
```

视觉要求：

| 元素 | 设计 |
|---|---|
| 字体 | odds/gap 15-17px tabular nums；market title 11px |
| icon | Fed building, rates curve, PMKT, CPI, recession |
| 颜色 | purple=PMKT gap；red=hawkish/hot；green=dovish/cool；amber=uncertain |
| 边框 | gap rows 用 purple left border；宏观方向用 row badge，不要整块变色 |
| 分布 | gap registry 在上，rates quote strip 在下；rates 不应喧宾夺主 |
| 重点 | 显示 “PMKT rich/cheap/inline”，而不是只显示收益率 |

---

## Panel 1: Polymarket Macro Market Map

这个 panel 是所有宏观 panel 的入口。它不先展示 CPI，而是先回答：

```text
现在 Polymarket 上有哪些和 CPI / Fed / recession / growth / oil 相关的活跃市场？
```

示例：

```text
PMKT MACRO MAP             LIVE

CPI MARKETS        6 active
FED MARKETS        14 active
RECESSION          4 active
OIL / ENERGY       8 active
NFP / UNEMP        3 active

TOP CATALYST       CPI release in 2d
BIGGEST VOLUME     Fed June decision
SIGNAL             CPI + FED CLUSTER ACTIVE
```

### 对 Polymarket 下注者的价值

这是交易路由层。用户不应该先看一堆宏观指标，然后再手动找市场；系统应该先知道当前可交易的宏观市场，然后把后续 panel 的信号挂到这些市场上。

适合关联的市场：

| 市场类型 | 用法 |
|---|---|
| CPI MoM / YoY bucket | 后续 nowcast 和价格压力 panel 的直接目标 |
| Fed rate decision | CPI、labor、growth 的下游反应 |
| recession / GDP | growth panel 的目标 |
| oil / energy | energy shock panel 的目标 |
| government shutdown | 影响数据发布时间和政治宏观市场 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| active events / markets | Polymarket Gamma API | 免费公开，不需要认证 |
| orderbook / midpoint / spread / price history | Polymarket CLOB API | 读接口公开；交易接口需要认证 |
| volume / liquidity / open interest | Polymarket API | 基本可免费读取 |

落地建议：不要 hardcode 市场 slug。用 Gamma API 搜索 `CPI`, `inflation`, `Fed`, `rates`, `recession`, `GDP`, `unemployment`, `oil` 等关键词，再按 volume、liquidity、endDate、resolution source 过滤。

---

## Panel 2: CPI Release Calendar & Consensus Baseline

这个 panel 负责事件时间和市场基准。

```text
CPI CALENDAR               OFFICIAL / EVENT

NEXT CPI        MAY 13 08:30 ET
NEXT PCE        MAY 29 08:30 ET
NFP             JUN 05 08:30 ET
FOMC            JUN 16-17

CONSENSUS CPI   0.3% MoM
PMKT MIDPOINT   0.34% implied
TIME TO EVENT   1d 14h
SIGNAL          EVENT RISK HIGH
```

### 对 Polymarket 下注者的价值

Polymarket 的宏观市场通常是事件驱动的。离公布越近，价格对新数据越敏感。这个 panel 应该帮助用户判断：

```text
现在是提前布局，还是已经进入 event-risk 阶段？
```

适合关联的市场：

| 市场类型 | 下注相关性 |
|---|---|
| CPI official release bucket | 最高 |
| PCE / Core PCE market | 高 |
| Fed meeting decision | 高 |
| NFP / unemployment | 中高 |
| recession / GDP | 中 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| CPI release date | BLS release calendar | 免费公开 |
| PCE release date | BEA release schedule | 免费公开 |
| FOMC date | Federal Reserve calendar | 免费公开 |
| NFP date | BLS release calendar | 免费公开 |
| consensus forecast | Econoday / Bloomberg / Reuters / TradingEconomics 等 | 高质量通常付费；免费源不稳定 |

落地建议：第一期先做 official calendar + Polymarket implied baseline。consensus 可以作为可选字段，不要依赖它作为核心功能。

---

## Panel 3: Energy & Gasoline Shock

能源是 headline CPI 的高频前置信号。Cleveland Fed inflation nowcasting 模型也使用 daily oil prices 和 weekly gasoline prices。

```text
ENERGY / GASOLINE SHOCK    EIA / MARKET

WTI              64.20     -1.1D
BRENT            67.80     -0.8D
GASOLINE         3.61      +0.04W
DIESEL           3.94      +0.02W
CRUDE STOCKS     +2.1M bbl

CPI IMPULSE      +0.04pp
LINKED PMKT      CPI headline / oil / Fed
SIGNAL           HEADLINE COOLING
```

### 对 Polymarket 下注者的价值

这个 panel 主要用于 headline CPI bucket，不应该直接用于 core CPI 判断。

可交易用法：

| 信号 | 可能影响 |
|---|---|
| gasoline 连续上行 | CPI MoM 偏热概率上升 |
| oil 上涨但 core 稳定 | headline hot / core stable |
| energy 快速回落 | headline CPI bucket 下修 |
| crude inventory surprise | oil market 和 CPI headline 的短期冲击 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| WTI / Brent / petroleum prices | EIA Open Data | 免费，需要注册 API key |
| gasoline / diesel retail price | EIA | 免费 |
| crude inventories | EIA Weekly Petroleum Status / Open Data | 免费 |
| real-time futures quotes | market data vendor | 免费源不稳定，实时授权通常受限 |
| waterway / tanker / AIS risk | AIS / maritime feeds | 高质量实时数据通常不完全免费 |

落地建议：第一期用 EIA daily/weekly 数据即可。AIS / waterway risk 可以二期做，不要让它阻塞 CPI panel。

---

## Panel 4: Food & Retail Basket Pressure

这个 panel 参考 WorldMonitor 的 `Consumer Prices` 设计，但 polyData 不能一开始就伪装成实时零售价格指数。当前已完成的一期实现是 **FRED/BLS CPI food components seed-first**，它是官方 CPI food 分项压力监控。二期再叠加 retail / commodity proxy，形成更接近 WorldMonitor 的消费价格面板。

worldmonitor 的 Consumer Prices panel 分成：

```text
Overview / Categories / Movers / Spread / Health
```

这套结构值得迁移，因为它回答的是 Polymarket 用户真正关心的问题：

```text
价格压力到底来自哪些商品？
```

示例：

```text
FOOD / RETAIL BASKET       OFFICIAL / PROXY

FOOD CPI           +3.1% YoY
FOOD AT HOME       +2.4% YoY
MEAT / EGGS        -0.6% MoM
FRUIT / VEG        +1.0% MoM
COVERAGE           5 / 5 official components
FRESHNESS          latest FRED/BLS

TOP RISERS
Fruit / veg        +1.0% MoM
Food CPI           -0.0% MoM
Food at home       -0.2% MoM

SIGNAL             FOOD STABLE
```

### 对 Polymarket 下注者的价值

这个 panel 对 CPI headline 和 food-at-home 分项有直接解释价值，但对 Polymarket CPI bucket 的使用必须区分两层：

```text
official food CPI components = 可信但低频
retail / commodity proxy     = 高频但噪声更大
```

可交易用法：

| 信号 | 可能影响 |
|---|---|
| BLS food-at-home / eggs / meat 分项加速 | headline CPI food contribution 上行风险 |
| commodity / retail proxy 先于 CPI 分项加速 | 下一期 food CPI 可能偏热 |
| 多个类别同步上涨 | 比单一食品异常更可信 |
| retail proxy stale / coverage 低 | 不应把零售层作为下注依据 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| food CPI components | FRED / BLS | 免费，已接入 |
| food at home / meats / fruit & veg / eggs | FRED / BLS | 免费，已接入 |
| FAO Food Price Index | FAO | 免费，但全球月频，不是美国 CPI |
| commodity food proxy | FRED / USDA / futures proxy | 多数免费或延迟免费；需要口径校验 |
| retailer shelf prices | 自建 scraper / retailer site | 免费但维护成本高，受网站结构和条款影响 |
| grocery basket index | 自建计算 | 可行，需要固定 basket 和归一化 |
| linked PMKT CPI markets | Gamma / CLOB | 免费公开读接口 |

落地建议：必须明确写出：

```text
Official layer tracks BLS/FRED CPI food components.
Retail proxy layer, if enabled, tracks consumer price pressure only and does not represent official CPI.
```

这个 panel 应作为 headline CPI / food-at-home driver，不应替代 Cleveland Fed nowcast。视觉上必须做成 category movers + source health，而不是只显示 summary tile。

---

## Panel 5: Supply Chain / Tariff / Import Price Watch

这个 panel 观察 goods inflation 和 tariff pass-through。

```text
SUPPLY / TARIFF WATCH      POLICY / TRADE

GSCPI             0.68
IMPORT PRICES     +0.4% MoM
CUSTOMS REV       +12% YoY
NEW FR NOTICES    3
SECTION 301       ACTIVE

GOODS CPI LINK    POSITIVE
LINKED PMKT       tariffs / China trade / CPI goods
SIGNAL            GOODS PRESSURE RISING
```

### 对 Polymarket 下注者的价值

这个 panel 不一定影响下个月 CPI headline，但会影响：

```text
goods CPI、tariff prediction markets、China trade markets、Fed inflation narrative
```

可交易用法：

| 信号 | 可能影响 |
|---|---|
| tariff notice 增加 | tariff / trade policy 市场 |
| customs revenue 上升 | tariff pass-through 可能增强 |
| import prices 上升 | goods CPI 上行压力 |
| GSCPI 上行 | supply-chain inflation narrative |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| GSCPI | New York Fed | 免费公开，通常文件/页面数据 |
| tariff notices | Federal Register API | 免费，不需要 API key |
| Section 301 actions | USTR | 免费公开 |
| customs revenue | Treasury Fiscal Data API | 免费 |
| import/export prices | BLS | 免费 |
| trade flows | Census / BEA / Comtrade | 多数免费；部分需要免费 key 或格式处理 |

落地建议：这个 panel 要有 `policy event` 和 `price pass-through` 两层，不要只列新闻。

---

## Panel 6: Shelter / Rent / OER Pressure

Shelter 是 CPI 中非常重要的组成部分。原来的 10 panel 缺少这个，是最大问题。

```text
SHELTER / RENT PRESSURE    OFFICIAL / LEADING

OER YOY           4.1%
RENT YOY          4.0%
ZILLOW RENT       +3.2%
APARTMENT RENT    +2.8%
HOME PRICES       +5.1%

LAG SIGNAL        DISINFLATION SLOW
LINKED PMKT       CPI core / Fed
SIGNAL            CORE STICKY
```

### 对 Polymarket 下注者的价值

Shelter 对 headline 和 core CPI 都很重要，尤其是 core CPI。能源可以让 headline 突然变热，但 shelter 决定 core inflation 是否 sticky。

可交易用法：

| 信号 | 可能影响 |
|---|---|
| OER / rent 放缓 | core CPI 下行概率上升 |
| rent leading indicators 重新加速 | core CPI sticky / Fed hawkish |
| shelter 与 nowcast 背离 | 判断 nowcast 风险 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| CPI Rent / OER | BLS / FRED | 免费 |
| Case-Shiller / FHFA home prices | FRED / FHFA | 免费 |
| Zillow Observed Rent Index | Zillow research data | 免费下载，但不是官方 CPI |
| Apartment List rent data | 公开报告/下载 | 可用性需定期验证 |

落地建议：把 shelter 做成 core CPI 的核心解释项，不要放在普通 housing panel 里。

---

## Panel 7: Labor / Wage / Services Pressure

工资和劳动力市场影响 services inflation 和 Fed reaction。

```text
LABOR / WAGE PRESSURE      BLS / DOL

NFP              +178K
UNEMPLOYMENT     4.1%
AHE MOM          +0.3%
ECI              +0.9% QoQ
INITIAL CLAIMS   214K
JOLTS            7.4M

SERVICES LINK    STICKY
LINKED PMKT      Fed / unemployment / recession
SIGNAL           FED HAWKISH
```

### 对 Polymarket 下注者的价值

这个 panel 对 CPI bucket 的直接影响弱于 energy/shelter，但对 Fed markets 很强。

可交易用法：

| 信号 | 可能影响 |
|---|---|
| wage growth 高 | core services sticky，Fed cut 概率下降 |
| claims 上升 | recession / unemployment / Fed cut 市场 |
| NFP 强 | Fed hold/hike 概率上升 |
| labor cooling + CPI cooling | dovish Fed market |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| NFP / unemployment / AHE | BLS API | 免费；v1 不需注册，v2 需免费注册 |
| JOLTS | BLS API | 免费 |
| ECI | BLS | 免费 |
| initial / continued claims | Department of Labor | 免费公开 |

落地建议：不要把 labor panel 只做就业数据表。它应该输出 `services inflation pressure` 和 `Fed impact`。

---

## Panel 8: Growth / Demand / Recession Tracker

需求侧决定通胀是否只是供应冲击，还是经济过热。

```text
GROWTH / DEMAND TRACKER    NOWCAST / OFFICIAL

GDPNow           3.7% SAAR
RETAIL SALES     +0.8% MoM
IND PROD         +0.1%
CONSUMPTION      FIRM
REAL INCOME      +0.2%

RECESSION SCORE  28 / 100
LINKED PMKT      GDP / recession / Fed
SIGNAL           SOFT LANDING
```

### 对 Polymarket 下注者的价值

这个 panel 对 CPI 的直接解释力中等，但对 recession、GDP、Fed markets 很有用。

可交易用法：

| 信号 | 可能影响 |
|---|---|
| GDPNow 上修 | recession 概率下降，Fed cut 概率下降 |
| retail sales 强 | demand inflation / soft landing |
| industrial production 弱 | growth slowdown |
| income/outlays 强 | demand pressure |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| GDPNow | Atlanta Fed | 免费，页面和 Excel 下载 |
| official GDP / PCE / income | BEA API | 免费，需要 API key |
| retail sales | Census API | 免费；高频/大量请求建议申请免费 key |
| industrial production | Federal Reserve / FRED | 免费 |

落地建议：这个 panel 的 signal 不要直接写 `CPI hot`，而是写 `demand supports inflation` 或 `growth cooling`。

---

## Panel 9: Inflation Nowcast & Official CPI Bridge

这是整条链的核心 panel。

```text
INFLATION NOWCAST          FED / MODEL

MONTH            MAY 2026
UPDATED          05/08
NEXT CPI         MAY 13 08:30 ET

CPI MOM          0.42%
CORE CPI MOM     0.21%
PCE MOM          0.38%
CORE PCE MOM     0.27%

CPI YOY          3.89%
CORE CPI YOY     2.61%
PCE YOY          3.93%
CORE PCE YOY     3.32%

HEADLINE-CORE    +0.21pp
PMKT GAP         +0.06
SIGNAL           HOT HEADLINE / CORE STABLE
```

### 对 Polymarket 下注者的价值

这个 panel 可以直接映射到 CPI / PCE bucket markets。

关键是把 nowcast 转成 market-readable signal：

```text
if Cleveland CPI MoM = 0.42%
and Polymarket market asks "CPI >= 0.4%"
then model-side probability should be compared with market price.
```

可交易用法：

| 信号 | 可能影响 |
|---|---|
| nowcast 高于 market implied bucket | CPI hot market 可能被低估 |
| nowcast 低于 market implied bucket | CPI cool side 可能更有价值 |
| headline hot / core cool | headline CPI market 比 Fed market 更相关 |
| core sticky | Fed cut market 更相关 |
| 1D / 7D nowcast 上修 | 市场可能尚未完全反应 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| CPI / Core CPI nowcast | Cleveland Fed | 免费公开；页面每日工作日更新 |
| PCE / Core PCE nowcast | Cleveland Fed | 免费公开 |
| MoM / YoY / quarterly annualized | Cleveland Fed | 免费公开 |
| official CPI | BLS | 免费 |
| official PCE | BEA | 免费，需要 API key |

落地建议：Cleveland Fed 没有明显稳定官方 API，第一期可以做 HTML 抽取 + schema validation + data freshness。不要只展示 MoM，要展示 MoM、YoY、quarterly annualized、last updated、next release、delta 1D/7D。

---

## Panel 10: Fed / Rates & Polymarket Macro Gap

最后一个 panel 把宏观信号和 Polymarket 价格合并。

```text
FED / PMKT MACRO GAP       OFFICIAL / MARKET

NEXT FOMC        JUN 16-17
TARGET RANGE     3.50-3.75
2Y YIELD         3.84
10Y YIELD        4.13
CURVE            +29 bps

PMKT FED CUT     38%
MODEL FED CUT    31%
GAP              PMKT +7pp

PMKT CPI HOT     42%
NOWCAST HOT      48%
GAP              PMKT -6pp

SIGNAL           CPI HOT UNDERPRICED / FED CUT RICH
```

### 对 Polymarket 下注者的价值

这是产品差异化最大的 panel。普通宏观看板停在数据层；这个 panel 应该直接告诉用户：

```text
市场价格和宏观数据是否一致？
```

可交易用法：

| Gap 类型 | 解释 |
|---|---|
| PMKT CPI probability < nowcast-implied probability | hot CPI 可能被低估 |
| PMKT Fed cut probability > macro-implied probability | Fed cut 可能偏贵 |
| PMKT recession probability > growth-implied probability | recession 可能偏贵 |
| PMKT oil shock probability < energy risk signal | energy shock 可能被低估 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| FOMC calendar / statement | Federal Reserve | 免费公开 |
| H.15 rates / yields | Federal Reserve / FRED | 免费 |
| Polymarket probabilities | Gamma / CLOB API | 免费公开读接口 |
| model-implied probability | 自建模型 | 可行，需要 calibration |

落地建议：第一期不要急着做复杂概率模型。可以先做三层：

```text
Level 1: directional gap
Level 2: threshold gap
Level 3: calibrated probability gap
```

例如：

```text
Nowcast CPI MoM 0.42% > market threshold 0.40%
PMKT yes price = 42%
Signal = hot CPI underpriced, confidence medium
```

---

## 4. 哪些数据真正能帮助下注？

不是所有宏观数据都能变成 edge。对 Polymarket 用户来说，优先级应该这样排：

| 优先级 | 数据 | 下注价值 | 原因 |
|---|---|---|---|
| P0 | Polymarket market map + orderbook | 最高 | 没有市场映射就无法交易 |
| P0 | CPI/PCE nowcast | 最高 | 可直接对 CPI/PCE bucket |
| P0 | release calendar | 最高 | 决定事件风险和倒计时 |
| P1 | energy/gasoline | 高 | headline CPI 高频驱动 |
| P1 | shelter/rent/OER | 高 | core CPI 主要粘性来源 |
| P1 | labor/wage | 高 | Fed markets 关键 |
| P1 | Fed/rates | 高 | 宏观市场下游定价 |
| P2 | retail basket | 中高 | 可做前置信号，但非官方 CPI |
| P2 | supply/tariff/import prices | 中高 | goods inflation 和政策市场 |
| P2 | growth/demand | 中 | 更适合 recession/GDP/Fed |
| P3 | fiscal/shutdown | 中 | 对政治宏观和发布时间有用 |
| P3 | broad risk reaction | 中 | 更像验证层，不是 CPI 主因 |

---

## 5. 免费数据可得性总表

| 数据源 | 免费吗 | 认证 | 稳定性 | 备注 |
|---|---|---|---|---|
| Polymarket Gamma API | 是 | 无 | 高 | 市场发现、events、markets |
| Polymarket CLOB read API | 是 | 读接口无 | 高 | orderbook、midpoint、spread、history |
| Cleveland Fed Inflation Nowcasting | 是 | 无 | 中高 | 免费页面；需要 HTML 抽取 |
| BLS API | 是 | v1 无；v2 免费注册 | 高 | CPI、jobs、JOLTS、wages |
| BEA API | 是 | 免费 key | 高 | PCE、GDP、income/outlays |
| EIA Open Data | 是 | 免费 key | 高 | oil、gasoline、diesel、inventories |
| Federal Reserve FOMC/H.15 | 是 | 无 | 高 | calendar、rates、yields |
| FRED | 是 | 免费 key | 高 | 很多宏观序列可统一取 |
| Treasury Fiscal Data | 是 | 无 | 高 | customs revenue、DTS、debt |
| Federal Register API | 是 | 无 | 高 | tariff notices、rules、EOs |
| OFAC SLS | 是 | 无 | 高 | sanctions lists/downloads |
| Census API | 是 | 免费 key 建议 | 中高 | retail sales、trade；注意 query limit |
| Atlanta Fed GDPNow | 是 | 无 | 中高 | 页面和 Excel；非官方 forecast |
| Retailer price scraping | 免费但脆弱 | 视网站而定 | 中低 | 维护成本高，需 freshness |
| ACLED | 免费访问 | myACLED / OAuth | 中 | 可用但不是无认证 |
| UCDP | 免费 | token 申请 | 中 | 2026 起需要 token |
| Real-time VIX/DXY/futures | 通常不完全免费 | vendor | 中低 | 官方历史数据可得，实时受限 |

---

## 6. 一期实现建议

第一期不是把 10 个 panel 缩成 8 个，而是给每个 panel 明确成熟度。已经完成的 panel 可以先作为 MVP 存在，但后续必须补齐 proxy / PMKT / visual semantics。

```text
MVP       official source + seed cache + source health
V1        official + proxy + PMKT linked markets
V2        event log + severity colors + ranked drivers + gap model
WorldMon  multi-source registry + filters + evidence + screenshot QA
```

推荐推进顺序：

```text
1. 补剩余 panel 的 MVP：supply, shelter, labor, growth, nowcast upgrade, fed gap
2. 回头升级已完成 panel 的视觉语义：geo, macro map, calendar, energy, food
3. 给每个 panel 增加 PMKT linked markets 和 gap strip
4. 再做 Headline CPI Pressure / Core CPI Pressure composite 汇总层
```

`Food & Retail Basket` 和 `Supply / Tariff` 不是低优先级，它们只是需要明确 official/proxy 边界。尤其 retail basket 不能被误解成官方 CPI。

---

## 7. 参考 WorldMonitor 的设计取舍

worldmonitor 里最值得借鉴的不是某个具体数据，而是 panel 组织方式：

| worldmonitor 设计 | 应该迁移到 polyData 的方式 |
|---|---|
| Consumer Prices 的 Overview / Categories / Movers / Spread / Health | CPI 前置信号 panel 也要解释来源、驱动项和 freshness |
| Energy Risk Overview 的独立 tile 降级 | 单个数据源失败不能让整个 panel 空白 |
| MacroTiles 的 US/EU tab | CPI / macro panel 可以按 US / EU 或 official / market 分 tab |
| PredictionPanel 的 market probability 展示 | 每个宏观信号都要能挂到 Polymarket 市场 |
| Market Implications 的 transmission chain | 给出 `driver → CPI → Fed → PMKT` 的路径解释 |

最终产品形态应该是：

```text
不是 Bloomberg 式宏观数据表
不是纯 Polymarket 市场列表

而是：

Macro data → CPI signal → Fed reaction → Polymarket mispricing
```

---

## 8. Source Links

- WorldMonitor reference: https://www.worldmonitor.app/
- Cleveland Fed Inflation Nowcasting: https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting
- Polymarket API docs: https://docs.polymarket.com/api-reference/introduction
- BLS API: https://www.bls.gov/developers/
- EIA Open Data: https://www.eia.gov/opendata/
- Federal Reserve FOMC calendars: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Federal Reserve H.15: https://www.federalreserve.gov/releases/h15/
- Treasury Fiscal Data API: https://fiscaldata.treasury.gov/api-documentation/
- Federal Register API: https://www.federalregister.gov/reader-aids/developer-resources/rest-api
- OFAC Sanctions List Service: https://ofac.treasury.gov/sanctions-list-service
- Atlanta Fed GDPNow: https://www.atlantafed.org/research-and-data/data/gdpnow
- Census API: https://www.census.gov/data/developers/guidance/api-user-guide/help.html
- UCDP API: https://ucdp.uu.se/apidocs/
- ACLED API docs: https://acleddata.com/api-documentation/getting-started
