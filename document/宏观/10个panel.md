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

## 1. 面向 Polymarket 的设计原则

每个 panel 都应该有固定结构：

```text
PANEL NAME                 LIVE / OFFICIAL / MODEL / MARKET

KEY VALUE                  value
DELTA 1D / 7D              change
NEXT CATALYST              release/event time
LINKED MARKETS             CPI / Fed / recession / oil / shutdown
PMKT GAP                   model-implied vs market-implied
SIGNAL                     HOT / COOL / STICKY / ENERGY-LED / MISPRICED
DATA HEALTH                updated / stale / unavailable
```

不要只展示数据。Polymarket 用户需要的是：

| 用户问题 | panel 应该输出 |
|---|---|
| CPI 会不会高于某个 bucket？ | nowcast vs market bucket gap |
| 通胀是 headline 热，还是 core sticky？ | headline-core gap、energy driver、services pressure |
| Fed 市场是否已经 price in？ | Fed implied probability vs CPI/labor/growth signal |
| 市场有没有低估某个事件？ | PMKT price vs external data / model probability |
| 数据是否还能信？ | freshness、source、coverage、staleness |

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
| 3 | `energy-gasoline-shock` | 待开发 | EIA daily / weekly oil、gasoline、diesel、inventories |
| 4 | `food-retail-basket-pressure` | 待开发 | Retail basket / public food pressure fallback |
| 5 | `supply-tariff-import-watch` | 待开发 | Federal Register / Treasury / BLS import prices |
| 6 | `shelter-rent-oer-pressure` | 待开发 | BLS/FRED/Zillow shelter pressure |
| 7 | `labor-wage-services-pressure` | 待开发 | BLS/DOL labor and services inflation pressure |
| 8 | `growth-demand-recession-tracker` | 待开发 | GDPNow/BEA/Census/Fed growth demand tracker |
| 9 | `inflation-nowcast` | 待升级 | 已有 panel；后续按新 seed + visual QA prompt 复核升级 |
| 10 | `fed-rates-polymarket-gap` | 待开发 | Fed/rates + PMKT gap layer |

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

这个 panel 参考 worldmonitor 的 `Consumer Prices` 设计：它不是官方 CPI，而是零售端价格压力监控。

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
FOOD / RETAIL BASKET       SCRAPE / DAILY

ESSENTIALS INDEX   104.2
WOW                +0.8%
MOM                +2.1%
COVERAGE           82%
FRESHNESS          6h ago

TOP RISERS
Eggs               +8.4%
Milk               +2.2%
Chicken            +1.8%

SIGNAL             FOOD PRESSURE RISING
```

### 对 Polymarket 下注者的价值

这个 panel 对官方 CPI 不是一一对应，但可以作为食品和生活成本压力的前置信号。

可交易用法：

| 信号 | 可能影响 |
|---|---|
| eggs / dairy / meat 大幅上涨 | food-at-home CPI 上行风险 |
| 多零售商同步涨价 | 更可信的广泛价格压力 |
| 单一零售商异常 | 可能是促销结束或 scrape 噪声 |
| freshness stale | 不应下注依赖该信号 |

### 数据可得性

| 数据 | 来源 | 免费可得性 |
|---|---|---|
| retailer shelf prices | 自建 scraper / retailer site | 免费但维护成本高，受网站结构和条款影响 |
| FAO Food Price Index | FAO | 免费，但全球月频，不是美国 CPI |
| grocery basket index | 自建计算 | 可行，需要固定 basket 和归一化 |
| source freshness | 自建 pipeline metadata | 可行 |

落地建议：必须明确写出：

```text
Does not represent official CPI. Tracks consumer price pressure only.
```

这个 panel 应作为 CPI nowcast 的辅助，不应替代 BLS CPI 或 Cleveland Fed nowcast。

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

## 3. 哪些数据真正能帮助下注？

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

## 4. 免费数据可得性总表

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

## 5. 一期实现建议

第一期只做能直接帮助 Polymarket 宏观下注的核心链路：

```text
1. Polymarket Macro Market Map
2. CPI Release Calendar
3. Energy & Gasoline Shock
4. Shelter / Rent / OER Pressure
5. Labor / Wage / Services Pressure
6. Inflation Nowcast & Official CPI Bridge
7. Fed / Rates
8. Polymarket Macro Gap
```

`Food & Retail Basket` 和 `Supply / Tariff` 可以作为 P2 加入；它们有价值，但需要更多数据清洗和解释，尤其 retail basket 不能被误解成官方 CPI。

---

## 6. 参考 worldmonitor 的设计取舍

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

## 7. Source Links

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
