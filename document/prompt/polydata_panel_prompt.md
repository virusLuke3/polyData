# polyData 新增 Panel 开发 Prompt

你正在为 `polyData / polymonitor` 新增一个 dashboard panel。

先读代码，再实现。必须复用现有架构，不要把逻辑堆进单个脚本，也不要在现有大文件里继续塞 panel 专属代码。

请把下面占位符替换成真实需求：

- `{panel_id}`
- `{panel_name}`
- `{panel_short_title}`
- `{runtime_route}`
- `{data_source}`
- `{display_goal}`

## 1. 必读代码

- `document/worldmonitor_panel_prompt.md`
- `document/新GCP远端服务控制手册.md`
- `docs/panel-modules.md`
- `webpage/src/components/Panel.tsx`
- `webpage/src/styles/panels.css`
- `webpage/src/styles/main.css`
- `webpage/src/panels/modules/index.ts`
- `webpage/src/panels/types.ts`
- `webpage/src/services/api.ts`
- `webpage/src/types.ts`
- `scripts/api/runtime_panels/registry.py`
- `scripts/api/runtime_panels/types.py`
- `scripts/api/routes/runtime_panels.py`
- `scripts/api/cache.py`
- `scripts/api/config.py`
- `scripts/data_sources.py`
- `document/开发/polydata_seed缓存架构优化方案.md`
- `scripts/runtime/seed_meta.py`
- `scripts/runtime/snapshot_store.py`
- 已有同类 watcher，例如 `scripts/runtime/geo_sanctions_shock_watcher.py`、`scripts/runtime/jin10_watcher.py`
- `scripts/api/services/system_service.py`
- `deploy/systemd/polydata.env.example`

## 2. 工作目标

新增一个可复用、可缓存、可测试、可部署、可在远端 GCP 验收的 panel：

- panel id: `{panel_id}`
- panel 名称: `{panel_name}`
- runtime route: `{runtime_route}`
- 数据源: `{data_source}`
- 展示目标: `{display_goal}`

## 3. 架构要求

前端必须拆分：

- 创建 `webpage/src/panels/modules/{panel_id}/index.ts`
- 在 `webpage/src/panels/modules/index.ts` 注册
- 在 `webpage/src/services/api.ts` 添加 fetch 方法
- 在 `webpage/src/types.ts` 添加 payload 类型
- 在 `webpage/src/styles/panels.css` 添加 panel 专属样式

后端必须拆分：

- 创建 `scripts/api/runtime_panels/modules/{panel_name}.py`
- 在 `scripts/api/runtime_panels/registry.py` 注册
- 如果抓取或清洗逻辑复杂，新增 `scripts/api/services/{panel_name}_service.py`
- 对需要外部抓取或清洗的 runtime panel，优先新增 `scripts/runtime/{panel_name}_watcher.py`，由 watcher 定时 seed Redis + SQLite snapshot，API 尽量只读已准备好的 snapshot
- 新增 watcher 时同步 `deploy/systemd/polydata-{panel_name}-seed.service`、`deploy/systemd/polydata.target`、`deploy/systemd/polydata.env.example`、`scripts/api/services/system_service.py` 的 seed-meta 监控项
- 不要新增 one-off route；runtime route 走现有 registry 自动注册

禁止：

- 把前后端逻辑塞进一个文件
- 在 `App.tsx` 添加 panel 专属状态管理或专属刷新逻辑
- 在 route 文件里手写 panel 专属接口
- 在代码里硬编码真实 URL、token、key、secret、proxy

## 4. 前端 / UI 通用设计合同

目标不是“给某一个 panel 换皮”，而是让所有 panel 都像同一套实时情报终端里的模块：暗底、细边框、高密度、强层级、短标签、稳定扫描路径。实现前必须先把 `{display_goal}` 翻译成明确的信息结构，再选择布局；不能把后端字段直接平铺成黑底白字，也不能默认套一个大卡片。

本节规则适用于所有 panel：news、signals、trades、flow、orderbook、asset quotes、macro、weather、sports、AI insight、system health 都必须遵守。不同业务可以有不同内容结构，但外层视觉语法必须统一。

必须先写出并落实这个 UI brief：

```text
Panel type:
Primary user question:
First-screen signal:
Main scan path:
Core entity:
Right-side value/status:
Allowed colors:
Allowed tags:
Empty/degraded behavior:
```

通用硬性要求：

1. 复用现有 `<Panel />` shell，不另造外壳，不破坏统一的 panel 边框、拖拽、固定高度和 header 结构。
2. panel 是固定高度 dashboard module。除非用户明确要求改尺寸，否则不要为了塞内容改 `PanelDefinition.size`；新增信息必须通过更紧凑布局、body 滚动、row 分组、drawer 或减少重复文字解决。
3. body 必须 `overflow-y: auto; overflow-x: hidden;`，使用深色细 scrollbar，不能出现亮白默认滚动条或页面级横向滚动。
4. 首屏必须能在 1 秒内扫到核心信号：左侧对象 / 中间标题和 meta / 右侧数值或状态。没有稳定扫描路径就不算完成。
5. 标题、row title、meta、badge、数值必须有清晰层级。不要让所有文字同字号、同字重、同颜色。
6. 颜色只能承载语义，不能装饰性乱用。金融/行情类默认以 green、red、white/gray 为主；新闻/事件类可使用标准 domain/severity 标签色；不要把所有标签都做成蓝色或绿色。
7. 不要默认套用厚卡片。只有 feed item、trade item、alert item、quote card、modal、drawer、可重复实体项才允许局部卡片；禁止大卡片套小卡片。
8. 每个 panel 的主视图应尽量展示“可以行动的信息”，而不是解释性废话。方法论、raw tags、长文本、证据链放到 drawer、tooltip 或详情区。
9. count、badge、tab、action 必须有真实含义。不要显示永远为 0 的统计，不要把没有数据的字段硬渲染成 UI 噪音。
10. 每个 UI 改动必须截图验收。截图里如果仍然像“黑底白字文字墙”、header 被挤压、内容被截断、横向滚动、颜色语义混乱，即使 build 通过也不能算完成。

推荐先判断 panel 主体类型：

| 类型 | 首选结构 | 第一眼重点 |
|---|---|---|
| feed / related intel / news | compact feed rows + tabs/filter strip | entity + source + severity + title |
| alpha / signal | dense signal list | signal direction + source + action |
| whale / trade tracker | trade ledger rows | actor/address + side + notional |
| flow watch | ranked opportunity cards | side + probability + market + watch tag |
| asset quotes / crypto / commodities | metric strip + quote rows/cards + sparkline | asset + price + delta |
| funding / basis / risk | pressure summary + ranked rows + venue cells | direction + extreme/watch tags + max value |
| order book / depth | bid/ask ladders + spread/last/depth strip | best bid/ask + spread + depth |
| AI insight | short insight cards + ranked focus rows | market-wide thesis + evidence |
| system/status | health matrix | service + status + timestamp |

### 4.1 标题栏设计要求

标题栏不是只有 `title + live + count`。要先判断这个 panel 的 header 属于哪一类，再决定是否加问号、排序、总结、设置、刷新等功能。

标题栏可包含的元素：

- 左侧：title、severity dot、info tooltip `?`、new badge、pro badge
- 右侧：data badge，例如 `LIVE` / `CACHED` / `STALE`
- 右侧：panel count
- 右侧：panel action buttons，例如 sort、summary、settings、refresh、tab trigger

标题栏判断规则：

1. 如果 panel 的数据含义、方法论、口径、来源规则不够直观，适合加 `?`：
   - 例如：signal、指数、评分、预测、positioning、macro 指标、系统健康、聚合类 intelligence panel
   - `?` 用来解释“这是什么、怎么来的、怎么读”，不是放操作
2. 如果 panel 只是直观列表或直观行情，通常不需要 `?`：
   - 例如：简单 news feed、基础 market quote、固定 schedule、基础 scoreboard
   - 只有在口径容易误解时才补 `?`
3. 如果 panel 的核心价值之一是“切换排序方式”，适合加 sort：
   - 例如：news / alerts / ranking / screener / scanner / table monitor
   - sort 必须直接改变当前 panel 的显示顺序，不能只是装饰按钮
4. 如果 panel 的核心价值之一是“把多条内容压缩成一条摘要”，适合加 summary：
   - 例如：news / report / intelligence / research feed
   - summary 不适合用在本身就只有 1-3 条卡片、或本身就是数值/行情面板的场景
5. 如果 panel 允许用户自定义观察对象、筛选集合、watchlist 或 source scope，适合加 settings：
   - 例如：market watchlist、source set、symbol set、region set、subscription set
   - settings 应打开轻量设置层或 modal，不要把复杂表单塞进 header
6. 如果 panel 数据刷新成本高、刷新动作对用户有意义、并且不是全局自动轮询就能满足，适合加 refresh：
   - 例如：手动查询、运营面板、状态检查、一次性抓取面板
   - 如果 panel 已稳定自动轮询，通常不需要再放显眼 refresh
7. 如果 panel 的主要交互是“切换视图 / 维度 / category”，优先使用 tabs 或 segmented control，通常放在 header 下方或 content 顶部，不要把太多切换按钮全部挤进 header
8. 一个 panel 的 header action 数量要克制：
   - 默认 0-2 个最合适
   - 超过 3 个通常说明应该把部分操作下沉到 tabs、toolbar 或 settings 内

标题栏实现约束：

- `?` 是小型解释按钮，不是菜单入口
- action button 必须有明确作用，不能为了“看起来像 WorldMonitor”硬加
- count badge 仍然放在最右侧或右侧末端，保持扫描稳定
- header 里的按钮优先使用小 icon button 或短文字按钮
- header 不能因为加按钮而导致 title 被压缩到难以识别
- 如果同一个 panel 同时需要 `?` 和 action buttons，`?` 放左侧 title 附近，action buttons 放右侧
- 如果 panel 是 locked / premium / empty state，header 仍应保持完整，但不要堆太多不可用操作

在实现说明里，必须明确写出：

- 这个 panel 是否有 `?`
- 为什么有或为什么没有
- 这个 panel 是否有 header action
- 每个 action 改变的是什么
- 为什么这些 action 应该放在 header，而不是放进 body

必须避免：

- landing page 风格
- oversized padding
- 大卡片套小卡片
- 大段说明性文字
- 所有 panel 都长得一样
- 用单一颜色承担全部语义
- 亮白默认 scrollbar
- 因固定列宽导致文字错位、重叠、横向滚动

### 4.2 WorldMonitor 风格可复用视觉系统

新增或改动 panel 时，必须先参考 WorldMonitor 的真实前端实现方式和当前 polyData 已经较好的 panel，例如 `RELATED INTEL`、`ALPHA SIGNAL`、`WHALE TRACKER`、`FLOW WATCH`、`COMMODITIES`、`CRYPTO`、`FUNDING RATE`。不要照抄某个具体业务 panel，要抽取它们共同的视觉语法：

```text
小字号 mono header + 可读 row title
暗底细边框 + 深色 body scroll
短标签承担状态，不用长句解释状态
行级 entity / source / side / severity 编码
左侧对象，中间标题，右侧数值或动作
行情类红绿白，事件类标准 domain/severity 标签
主视图压缩，细节进 drawer / tooltip / detail
```

通用观感基准：

- panel header 高度稳定，title 不被 badge、count、action 挤压。
- row/card 之间用细 divider、低透明背景、窄 accent border 分隔，不靠大块高饱和背景。
- 每个 panel 首屏至少能看到 2-5 个有效对象；如果一个 panel 首屏只能看到一条大卡片，通常说明字号、padding 或内容层级失败。
- 数值、概率、价格、volume、trade count 固定放右侧或独立数值列，让用户能纵向扫描。
- source、timestamp、address、market id、venue 等 meta 用 dim mono；title 和核心实体用更亮的白或业务高亮色。
- row hover 只能轻微变亮或平移 1px，不要大面积发光。

#### 4.2.1 字体层级

panel 内字体必须有明确层级，不允许所有文字都使用同样大小和字重。

推荐层级：

| 用途 | 建议 |
|---|---|
| panel title | 10.5-12px, uppercase, 700-800, letter-spacing 0.08-0.14em；短标题优先 |
| header badge/count/action | 9-11px, mono, fixed/min width, flex-shrink 0 |
| hero signal | 13-15px, 700-800，只给最重要的一句话，不要大段 hero 文案 |
| row title | 11.5-13px, 650-750, 最多 1-2 行 |
| row meta / source | 8.5-10px, uppercase, dim color, letter-spacing 0.04-0.08em |
| numeric value | 14-18px, tabular-nums, 700-850 |
| badge / chip | 8-10px, uppercase, 750-900 |
| table header | 8.5-9.5px, uppercase, dim color |
| description / summary | 10-11px, dim, 1-2 行，不与 title 同色同重 |

要求：

- 数值必须使用 `font-variant-numeric: tabular-nums`，保证扫描稳定。
- 不要把正文、meta、badge 全部做成粗体。
- 不要用 hero 级字号塞进 compact row 或 chip。
- 中文界面也要保留清晰层级，不要因为中文更占宽就加大字号。
- 长标题优先用 `line-clamp`、更短 title、或把细节移入 summary/detail，不要让 title 把 row 高度撑爆。
- panel header title 的字号必须和其它 panel 保持一致；不能因为某个 panel 名称长就把整个 header 做大。

#### 4.2.2 Panel 边框和容器

panel shell 必须克制，像情报终端而不是 landing card。

推荐风格：

```text
panel background: 深色 surface
outer border: 1px solid subtle border
header background: 极轻 overlay
header bottom border: 1px solid subtle border
body padding: 6-10px
row divider: rgba(255,255,255,0.04-0.08)
hover: rgba(255,255,255,0.03-0.06)
border radius: 0-6px，避免大圆角
scrollbar: 4px 深色细滚动条
```

要求：

- 边框用于分隔信息，不用于装饰堆叠。
- 不要卡片套卡片。只有 feed item、modal、drawer、可重复实体项才适合局部卡片。
- hero signal 可以使用左侧或顶部 accent border，但不要整块铺高饱和背景。
- panel 内容超出固定高度时，body 内部滚动，不改变 panel 尺寸。

#### 4.2.3 Icon / Glyph 规则

icon 不是装饰，必须成为分类编码。每个 panel 至少定义一套稳定的语义 icon/glyph 映射。

推荐做法：

| 类型 | 示例 |
|---|---|
| source icon | BLS, BEA, Fed, EIA, FRED, Treasury, Federal Register, PMKT |
| event icon | calendar, release, policy notice, shock, sanction, Fed meeting |
| category icon | CPI, core, food, energy, shelter, labor, growth, rates |
| market icon | PMKT odds, orderbook, volume, expiry |
| status icon | official, live, cached, stale, degraded, watch |

要求：

- hero 区需要一个明显 icon tile，作为第一眼视觉锚点。
- registry/list/table 的每一行也应该有 row-level icon，帮助快速分类。
- icon 与颜色要绑定语义，例如 EIA/official 用蓝色，PMKT 用紫色，hot/risk 用红或橙。
- 不要只在标题旁放一个 icon 后，正文继续变成纯文字墙。
- icon 尺寸要克制，通常 14-18px 足够；hero icon tile 可略大但不要喧宾夺主。
- 优先使用项目已有 icon / lucide / 现有 glyph 风格；不要临时混用多个视觉体系。

#### 4.2.4 颜色语义

颜色必须表达状态，不是装饰。

统一语义：

| 颜色职责 | 含义 |
|---|---|
| red / coral | 下跌、卖压、负 delta、alert、critical、风险升高、异常冲击 |
| green / teal | 上涨、买压、正 delta、live、ok、可用、新鲜、正向流动 |
| white / near-white | 主标题、关键数值、中性但重要的信息 |
| gray | source、timestamp、id、地址、venue、fallback、unavailable、neutral meta |
| amber / yellow | watch、mixed、uncertainty、stale warning、待确认风险 |
| blue / cyan | 官方来源、可验证信息、链接、非交易类 entity 高亮 |
| purple | Polymarket / PMKT / CLOB / odds / trading layer |

要求：

- 金融、行情、资金费率、crypto、commodities、trade flow 这类 panel 默认只使用 green / red / white / gray 作为主色。只有 `PMKT`、`CLOB`、`OFFICIAL`、`WATCH` 这类来源或风险标签需要额外语义时，才引入 purple / amber / blue，并且必须克制。
- 新闻、事件、AI insight、geo/security、weather 这类 panel 可以使用 WorldMonitor 式 domain/severity 标签色，但同一行中最多 1 个强实底告警标签。
- 不要把 `WATCH`、`ALERT`、`RISK`、`METALS`、`ECONOMIC` 等所有 chip 都做成蓝色。蓝色只用于官方/信息/链接/部分 entity 高亮。
- 不要大面积使用高饱和背景；高饱和色只用于 badge、delta、accent border、icon glow、active tab。
- 同一语义在不同 panel 内保持一致，比如 `ALERT` 永远是 red/coral，`LIVE` 永远是 green，`PMKT` 永远偏 purple，数据缺失永远 gray/amber。
- 数据缺失 / degraded / no book / no rows 只能用 gray / amber，不能用 red 伪装成真实风险信号。
- trend delta 必须有方向色，且数值方向与颜色一致；不要出现上涨红、下跌绿，除非该业务明确反向解释并在 UI 中说明。

#### 4.2.5 信息分布模型

实现前必须先判断 panel 的主体结构，不允许所有 panel 默认做成厚卡片。

常用结构：

| 场景 | 首选结构 |
|---|---|
| 多个市场 / 事件 / source / entity | registry table / compact list |
| 价格、odds、spread、delta | quote row / market row |
| release / event | timeline / calendar list |
| source 状态 | health matrix |
| 少量核心 driver | driver strip + ranked rows |
| 新闻 / headlines / alerts / wire | compact feed row |
| 需要解释细节 | row click drawer |
| whale / alpha / flow | ledger row：actor/source + side + title + notional/action |
| asset board | summary strip + dense quote cards/rows + sparklines |
| funding / basis / risk | pressure headline + tags + ranked instruments + venue mini-cells |

推荐固定骨架：

```text
HEADER: title + ? + data badge + count/action

HERO SIGNAL STRIP:
  icon tile + primary signal + source/confidence/market implication

FILTER / CATEGORY CHIPS:
  3-6 个以内，横向可滚动但不能产生页面横向滚动

REGISTRY / TABLE:
  icon + title/meta | value/date/source | status/odds badge

DETAIL DRAWER:
  点击 row 后覆盖 panel body，展示 source、method、timeline、evidence
```

要求：

- 单个 panel 必须有一个第一眼焦点，不能所有模块同等重要。
- 右侧列应稳定放数值、odds、delta、status，让用户能扫右列。
- 列表行比 KPI 卡片更适合高密度情报。
- 细节文字放 drawer，不要塞进主视图。
- 如果必须用 grid，grid 中每个 cell 应有不同职责，不要只是平均展示几个大数字。
- tabs/segmented control 应该像 `RELATED INTEL` 或 `COMMODITIES` 一样放在 body 顶部，尺寸稳定、数量少、可扫读；不要把过多 tabs 挤进 header。
- compact metric strip 可以放 2-4 个真正有用的指标，例如 `TOP MOVE`、`AVG 24H`、`ALERTS`、`GREEN`；不要展示永远为 0 或用户无法解释的指标。
- sparkline 只服务于趋势扫描，不能占掉主要阅读空间；小行情 row 内 sparkline 高度通常 24-38px 足够。
- 每个 row 的右侧动作按钮必须明确，例如 `Sell Yes`、`WATCH`、`Read source`；不要放纯装饰按钮。

#### 4.2.6 Feed / News / List Panel 专用视觉规范

开发 news、wire、headline、alert feed、market news、weather news、macro news 这类 panel 时，必须采用高密度 feed/list 结构，而不是 KPI 卡片或大段文字卡片。

这里的“高亮对象”必须是业务核心实体，不固定为城市：

| panel 类型 | 推荐高亮实体 |
|---|---|
| weather news | city / region / hazard |
| financial news | ticker / company / asset / sector |
| macro feed | country / release / agency / indicator |
| market feed | market slug / event / outcome / PMKT |
| sports feed | team / league / player |
| geo/security feed | country / region / actor / facility |

推荐结构：

```text
HEADER:
  TITLE + optional ? + data badge + optional sort action + count

BODY ROW:
  row accent stripe or glyph
  meta line: primary entity / source / severity / tags
  title: 1-2 lines
  summary: 1-2 lines
  footer: relative time + source/action link
```

标题栏规则：

- feed 来源、筛选、排序口径不直观时，允许加 `?`，并放在 title 旁边。
- `LIVE` / `CACHED` / `SEED` 是数据状态 badge，不是排序按钮。
- `LATEST` / `ALERTS` / `ENTITY` / `IMPACT` 这类短文字按钮是排序 action，必须真实改变列表顺序。
- count 只表达当前可见或可用条目数量，不要放没有解释意义的统计数。
- header 必须使用 `min-width: 0`、稳定 gap、固定按钮尺寸或 `flex-shrink: 0`，避免 badge、action、count 与标题互相覆盖。
- 如果 title 过长，优先缩短 title；不要让 header 变成多行混乱布局。

feed row 布局规则：

- 每条 item 使用 compact row，不使用厚重大卡片。
- row 左侧可用 2-4px accent border 表达风险等级，例如 critical/coral、watch/amber、normal/subtle。
- meta line 必须先出现核心实体，再出现 source，再出现 severity/tag。
- 核心实体必须视觉突出，但实体类型由业务决定；不要硬编码 city 高亮，也不要在金融价格走势 panel 里强行套 news 高亮规则。
- source 使用 dim gray，小字号，不要和核心实体抢视觉优先级。
- severity badge 使用高对比颜色，例如 `ALERT` 红底、`WATCH` amber、`FORECAST`/`MODEL` muted purple；不要把所有 tag 都做成同样颜色。
- title 是 row 主体，推荐 12-13px、600-700、最多 2 行。
- summary 是辅助信息，推荐 10-11px、dim color、最多 2 行。
- footer 放相对时间和 source/action link，字号小，但链接颜色要可见。
- row hover 只用轻微 overlay，不要大面积发光。
- 每条 row 可以整体 clickable，也可以只让 action link clickable；如果整体 clickable，仍保留明显 action/source link。

feed row CSS 约束：

```text
row padding: 8-10px
row gap: 4-6px
row divider: 1px solid subtle border
meta line: display flex; flex-wrap: wrap; min-width: 0
title/summary: overflow hidden; display -webkit-box; -webkit-line-clamp: 2
body: overflow-y auto; overflow-x hidden
scrollbar: 4px dark
```

必须避免：

- 在 feed 顶部塞无意义 KPI，例如 `LATEST 607 warnings / CITIES 33 / TOP CITY Chicago`，除非这些指标能直接指导用户行动。
- 单条 item 使用过大字号，导致一个 panel 首屏只能看到 1 条内容。
- 核心实体、source、tag、title 全部同级同色，用户无法扫读。
- `ALERT` 这类 tag 横跨整行或占据过大面积。
- summary 与 title 重复但没有层级差异。
- header action 和 badge 重叠。
- 因为长 source、长实体名、长 title 造成横向滚动。

推荐颜色语义：

| 元素 | 推荐语义 |
|---|---|
| primary entity | cyan / blue highlight，或跟随业务主题色 |
| source | dim gray |
| alert / critical | red / coral |
| watch / uncertainty | amber |
| category / model / forecast | muted purple |
| freshness live | green |
| stale / cached / seed | gray or amber |
| source/action link | cyan underline |

#### 4.2.7 Badge / Chip / 状态件

所有状态必须尽量状态件化，而不是裸文字。

必须设计的状态件：

```text
severity badge: HOT / COOL / WATCH / NEUTRAL / CRITICAL
source badge: BLS / BEA / FED / EIA / FRED / PMKT / FR
freshness badge: LIVE / SEEDED / CACHED / STALE / DEGRADED
market badge: odds / spread / volume / close time
evidence badge: OFFICIAL / PROXY / FALLBACK / OPTIONAL
```

设计约束：

- badge 高度要小，通常 padding 1-3px 6-8px。
- badge 字号 8-10px，uppercase，semibold/bold。
- 圆角 2-10px，避免过大的 pill 破坏密度。
- 不要每行塞太多 badge；通常 1 个主状态 + 1 个来源足够。
- badge 颜色必须来自语义，不要随机配色。

#### 4.2.8 标签归一化与复用规则

新增 panel 时，不要直接把后端返回的 `tags`、`category`、`status`、`source` 全量渲染成 UI chip。原始标签通常混杂了业务分类、数据源、市场结构、时间周期、隐藏标记和系统内部标记，必须先归一化成可复用的 UI 标签层。

目标不是发明一套新 chip，而是复用 WorldMonitor 截图里的短标签视觉语言：`ONGOING`、`ALERT`、`DIPLOMATIC`、`ECONOMIC`、`MILITARY`、`CONFLICT`、`CYBER`、`CRIME`、`HEALTH`、`WIRE`、`POLYMARKET`。后端原始 tags 只作为输入，前端显示必须落到标准词表。

标准 UI 标签词表：

| 类型 | 标准标签 | 用途 |
|---|---|---|
| freshness | `LIVE` / `CACHED` / `STALE` / `SEED` / `DEGRADED` | panel 右上角数据状态 |
| event state | `ONGOING` / `BREAKING` / `DEVELOPING` / `SUSTAINED` / `CLOSED` / `RESOLVED` | 新闻、事件、市场状态 |
| severity | `ALERT` / `WATCH` / `CRITICAL` / `HOT` / `COOL` | 风险强度、异常强度、方向性 |
| geo/politics | `DIPLOMATIC` / `CONFLICT` / `MILITARY` / `GOVERNMENT` / `ELECTION` | 地缘、政治、政府类内容 |
| economy/market | `ECONOMIC` / `FINANCE` / `COMMODITY` / `ENERGY` / `STOCK` / `CRYPTO` | 宏观、金融、资产价格 |
| security/social | `CYBER` / `CRIME` / `HEALTH` / `INFRASTRUCTURE` / `DISASTER` / `WEATHER` | 风险、公共安全、灾害、天气 |
| source/trading | `WIRE` / `OFFICIAL` / `PMKT` / `POLYMARKET` / `CLOB` / `GAMMA` / `DB` | 来源、可信度、交易数据层 |
| market shape | `YES/NO` / `UP/DOWN` / `MULTI` / `NEG-RISK` / `RECURRING` / `NO BOOK` | Polymarket 专属市场结构 |

标准标签颜色：

| 标签 / 类型 | 颜色职责 | 推荐样式 |
|---|---|---|
| `ALERT` / `CRITICAL` | 最高优先级风险 | red/coral 实底，深色文字；只给真正告警 |
| `CONFLICT` | 冲突、战争、武装风险 | red 描边或低透明红底，红字；不要和 `ALERT` 一样满实底 |
| `ONGOING` / `DEVELOPING` / `SUSTAINED` | 事件阶段 | blue-gray / slate 底，冷灰字；表达“正在发生”但不代表高风险 |
| `WATCH` | 观察、潜在风险、不确定 | amber 描边 + 低透明 amber 底 |
| `DIPLOMATIC` / `GOVERNMENT` / `ELECTION` | 政治、外交、政府 | orange / burnt amber，低透明底 |
| `ECONOMIC` / `FINANCE` / `COMMODITY` / `ENERGY` | 宏观、金融、资源 | yellow / gold，低透明底 |
| `MILITARY` | 军事、国防、部队 | green / tactical green，低透明底 |
| `CYBER` | 网络安全、攻击、漏洞 | cyan / electric blue，低透明底 |
| `CRIME` | 执法、司法、犯罪 | yellow-green / olive，低透明底 |
| `HEALTH` | 疫情、公共卫生 | magenta / rose，低透明底 |
| `INFRASTRUCTURE` / `DISASTER` / `WEATHER` | 基础设施、灾害、天气 | cyan / weather blue，低透明底 |
| `WIRE` / `OFFICIAL` | 高可信来源 | green 或 blue 实/半实底，带小 glyph 可选 |
| `PMKT` / `POLYMARKET` | Polymarket 交易层 | purple 实/半实底 |
| `CLOB` / `GAMMA` / `DB` | 价格来源 | muted purple/gray；`CLOB` 可比 `GAMMA` 更亮 |
| `UP/DOWN` / `MULTI` / `NEG-RISK` / `YES/NO` | 市场结构 | neutral gray 或 purple-gray，避免抢过价格 |
| `NO BOOK` / `STALE` / `DEGRADED` | 数据缺失、非实时 | gray 或 amber，不用 red，避免伪装成风险 |
| `LIVE` | 数据新鲜 | green pill，通常只放 header |
| `CACHED` / `SEED` | 缓存或 seed 数据 | gray/amber pill，通常只放 header |

实现约束：

- 同一标签在所有 panel 中必须使用同一色系；不要在 weather 里把 `ALERT` 做红色，在 finance 里又改成黄色。
- 高饱和实底只留给少数最高优先级标签：`ALERT`、`WIRE`、`POLYMARKET`、必要时 `LIVE`。普通 domain 标签使用描边或低透明底。
- 一行里如果同时出现 `ALERT` 和 domain 标签，`ALERT` 是唯一强实底；domain 标签必须降饱和。
- `ONGOING` 表示阶段，不表示危险，不能用 red。
- `ECONOMIC` 与 `DIPLOMATIC` 都偏暖色，但必须区分：`ECONOMIC` 用 yellow/gold，`DIPLOMATIC` 用 orange/burnt amber。
- `MILITARY` 不使用红色，除非同时有 `ALERT` 或 `CONFLICT`；军事域本身推荐 tactical green。
- `NO BOOK`、`MISSING`、`STALE`、`DEGRADED` 是数据质量，不是业务风险，优先 gray/amber。

原始标签到标准标签的映射示例：

| 原始输入 | 显示标签 |
|---|---|
| `politics`, `world`, `geopolitics`, `middle-east`, `ukraine` | `DIPLOMATIC` / `CONFLICT` / `GOVERNMENT`，按标题语义选 1-2 个 |
| `economy`, `economic`, `finance`, `business`, `equities`, `stocks` | `ECONOMIC` / `FINANCE` / `STOCK` |
| `sports`, `nba`, `nfl`, `mlb`, `soccer`, `tennis`, `esports` | `SPORTS`，必要时加联赛/队伍作为 entity，不作为 tag 堆叠 |
| `crypto`, `bitcoin`, `ethereum`, `solana`, `crypto-prices` | `CRYPTO`，资产名作为 entity |
| `weather`, `temperature`, `daily-temperature`, `highest-temperature`, `precipitation` | `WEATHER`，必要时加 `TEMP` / `PRECIP` |
| `up-or-down` | `UP/DOWN` |
| `multi-strikes` | `MULTI` |
| `neg-risk` | `NEG-RISK` |
| `recurring`, `5m`, `15m`, `1h`, `weekly` | `RECURRING` + 周期短标签，或放 detail |
| `hide-from-new`, `rewards-*`, `unknown`, `orphaned` | 默认不显示 |

推荐统一为 6 条 UI tag lanes：

| lane | 作用 | 示例 | 推荐位置 |
|---|---|---|---|
| freshness | 数据是否可用、是否新鲜 | `LIVE` / `CACHED` / `STALE` / `SEED` / `DEGRADED` | panel header |
| severity | 当前信号强度或风险 | `ALERT` / `WATCH` / `HOT` / `COOL` / `CRITICAL` | row meta 或右侧 |
| source | 数据来源或可信度 | `PMKT` / `CLOB` / `GAMMA` / `DB` / `BLS` / `EIA` / `TIER 1` | row meta |
| domain | 业务主题 | `DIPLOMATIC` / `ECONOMIC` / `CONFLICT` / `MILITARY` / `WEATHER` / `CRYPTO` | row meta |
| market | 市场结构和交易状态 | `YES/NO` / `MULTI` / `NEG-RISK` / `NEW` / `ENDING` / `NO BOOK` | quote/market row |
| entity | 当前行的核心对象 | `AAPL` / `NYC` / `FED` / `UKRAINE` / `NBA` / `BTC` | row title 或 meta 的第一位 |

显示优先级：

```text
header: freshness + count/action
row meta: entity + source + 1 severity + 1 domain
quote row: market structure + price/liquidity state
drawer/detail: 展开显示全部 raw tags 和解释
```

要求：

- 主视图每行通常最多显示 3-4 个 tag；多余标签放 drawer、tooltip 或 detail。
- 原始 `hide-from-new`、`recurring`、`5m`、`15m`、`weekly`、`rewards-*` 这类系统/周期标签不能无脑展示，必须转换成用户能读懂的 UI tag，例如 `RECURRING`、`5M`、`WEEKLY`，或完全隐藏。
- `category` 不一定等于 UI domain。比如 Polymarket 的 `weather` 可以拆成 `TEMP` / `PRECIP` / `HURRICANE` / `CLIMATE`；`crypto-prices` 可以拆成 `CRYPTO` + `UP/DOWN` + `5M`。
- 同一行不要同时显示多个同义标签，例如 `finance` 和 `economic` 同时出现时，只保留更具体或更有用的一个。
- entity 不是 badge 堆叠的附属品，它是扫描锚点；金融面板高亮 ticker/company，新闻面板高亮事件主体，weather 面板高亮城市/灾害，sports 面板高亮队伍/联赛。
- `ALERT`、`CRITICAL`、`WIRE`、`PMKT`、`CLOB` 这类高价值标签可以高亮；普通 domain tag 应低饱和，不能抢过标题。
- 如果一个 panel 需要新标签，必须优先映射到上面的标准词表和 6 条 lane；只有标准词表表达不了时，才新增标签，并在实现说明里解释新增原因。

#### 4.2.9 业务域视觉映射

每个 panel 都必须先选择自己的业务域视觉映射。不要把某个 panel 的颜色和结构硬套到所有业务上；要抽取“暗底、细边框、短标签、稳定扫描路径”的共性，再按业务选择 entity、数值、标签和颜色。

推荐映射：

| 业务域 | 核心 entity | 主视图结构 | 主色规则 |
|---|---|---|---|
| market / PMKT | market / event / outcome | market row + odds/volume/end time | PMKT purple 只作来源/market tag；价格方向用 red/green/white |
| orderbook | side / price level | bid/ask ladder + spread strip | bids green, asks red, neutral white/gray |
| trade / whale / flow | address / actor / side | ledger rows + notional/action | buy/positive green, sell/negative red, meta gray |
| alpha / signal | source / signal / market | signal rows + action chip | bullish/positive green, bearish/risk red, source dim |
| commodities / crypto / equities | asset / ticker | metric strip + quote row/card + sparkline | up green, down red, label white/gray |
| funding / basis / rates | instrument / venue | pressure summary + ranked rows + venue cells | longs/positive green, shorts/negative red, mixed white/gray/amber |
| news / related intel | entity / source | compact feed rows + tabs | severity/domain tags; title white; source gray |
| macro / policy | agency / indicator / release | signal strip + ranked drivers + PMKT link | hot/risk red, cool/ok green, watch amber, official blue |
| weather / geo / security | location / actor / facility | feed rows + severity/domain tags | alert red, domain tags standardized, location highlighted |
| AI insight | thesis / focus / evidence | short insight cards + ranked evidence rows | insight card white/gray, confidence/source as tag |
| system health | service / dependency | status matrix | ok green, degraded amber, down red, unknown gray |

每个 panel 的主视图至少包含：

```text
1 个核心 entity 或 source mark
1 条 primary signal / primary row / active quote
2-5 条 ranked rows 或有效 item
1 个 freshness/source 状态
1 个右侧稳定数值或状态列
```

如果某个业务没有足够数据满足以上结构，必须用清晰 empty/degraded state 说明缺什么，并避免显示一堆 `0`、`--`、无意义 tabs。

#### 4.2.10 当前截图基准

当前 polyData 中已经较接近目标的 panel，应作为后续通用基准，而不是只服务于某一个 panel：

| 参考 panel | 可复用优点 | 不要误用 |
|---|---|---|
| `RELATED INTEL` | 顶部 tabs + 分类小计 + compact feed rows，适合多来源内容聚合 | 不要让 tabs 过多，不能展示永远为 0 的 tab |
| `ALPHA SIGNAL` | ledger 式信号行，source/side/action 清楚，右侧动作稳定 | 不要把所有文本同色同重，source/action 要降噪 |
| `WHALE TRACKER` | trades/flow/signals 结构清楚，右侧 notional 便于纵向扫描 | 不要让长 market title 挤掉数值列 |
| `FLOW WATCH` | opportunity card 里有 side、probability、market、watch 状态 | 不要把每张卡做得过高，首屏至少要看到多条机会 |
| `COMMODITIES` | metric strip + asset cards + sparkline + short tags | tag 不能全蓝；资产类别 tag 应弱化，方向和告警才高亮 |
| `CRYPTO` | quote row 更适合高密度行情，价格和 delta 右侧稳定 | sparkline 不要压过价格；长价格要防溢出 |
| `FUNDING RATE` | pressure summary + ranked instrument rows + venue mini-cells | 这只是 funding 的结构，不要硬套给 news/AI/system panel |

通用化提炼：

- header 用短 title、短 badge、count，避免长文字按钮挤压标题。
- body 顶部可以有 tabs 或 summary strip，但必须解释当前列表如何被筛选/排序。
- 主内容优先 row/list/ledger，而不是大面积说明卡。
- 强色只给方向、风险、实时性、动作；普通分类、来源、venue、address 必须 dim。
- item 要能快速扫：entity/source -> tag/side -> title/market -> value/action。
- 所有 panel 都应该支持内容变多后的稳定滚动，不应通过增加 panel 高度解决。

#### 4.2.11 WorldMonitor 级视觉验收口径

截图验收时，除了检查 overflow，还必须人工或自动判断：

- 第一眼是否能看出 panel 的主要信号。
- 是否存在 row-level icon，而不是只有标题 icon。
- 是否至少有 2-3 种语义颜色承担不同职责。
- 是否存在明确的 status badge / source badge。
- 是否有稳定扫描路径：左侧对象，中间 meta，右侧数值或状态。
- 是否有过多同级文字导致视觉疲劳。
- 是否把细节解释放进 drawer / 展开区，而不是主视图文字墙。
- 是否保持固定 panel 尺寸，没有因为内容变多改 `PanelDefinition.size`。
- 是否符合暗底、细边框、紧凑间距、低圆角的 dashboard module 风格。
- feed/news/list panel 首屏是否至少能看到 2 条有效 item，且每条都能扫到核心实体、来源、标题、时间。
- 核心实体高亮是否符合业务类型，而不是所有 panel 都硬套城市高亮。

如果截图看起来仍然是“黑底白字文字墙”，即使 build 和 DOM overflow 都通过，也不能算完成。

## 5. 数据源与配置要求

先确认 `{data_source}`：

- 是否可用
- 是否稳定
- 是否允许缓存
- 是否有限流
- 是否需要 key / token / app id / proxy
- 远端 GCP 是否可访问

所有配置必须走环境变量，并同步以下位置：

- 本机 `.env` 或 `.env.local`
- 远端 `~/.config/polydata/polydata.env`
- `deploy/systemd/polydata.env.example` 只写占位符，不写真实值

推荐命名：

```bash
POLYDATA_{PANEL_NAME}_API_URL=
POLYDATA_{PANEL_NAME}_API_KEY=
POLYDATA_{PANEL_NAME}_SOURCE_URL=
POLYDATA_{PANEL_NAME}_TTL_SECONDS=
```

必须遵守：

1. 所有外部请求都要有 timeout。
2. 数据源失败、超时、字段缺失、返回空数据时，后端仍要返回可渲染 payload。
3. 优先接入 seed-first 缓存模式：watcher 定时抓取外部源并写入 Redis + SQLite snapshot；API handler 优先只读 snapshot。
4. 不要用空结果覆盖已有可用 snapshot。
5. 如果没有 watcher，必须在实现说明里解释为什么只使用 request-time `get_snapshot_payload`；这只能作为过渡方案，不应作为外部源 panel 的默认形态。

建议 payload 结构：

```json
{
  "generatedAt": "...",
  "source": "...",
  "sourceUrl": "...",
  "status": "ok|degraded|empty|invalid|warming",
  "cacheMode": "seeded|redis-seed|sqlite-seed|stale-seed|live-build|warming",
  "sources": {},
  "items": []
}
```

### 5.1 Seed / 缓存架构要求

新增 panel 时参考 `document/开发/polydata_seed缓存架构优化方案.md`。目标链路是：

```text
Source Worker / watcher
-> Redis fresh cache + SQLite snapshot + stale snapshot
-> seed-meta / source health
-> Read API only trims / limits / reshapes snapshot
-> Frontend consumes runtime payload
```

实现要求：

- Redis key 遵守 `polydata:snapshot:{domain}:{panel}:{cache_key}`，seed-meta 遵守 `polydata:seed-meta:{domain}:{panel}`。
- watcher 中完成外部源抓取、解析、评分、source health 判断；API 不承担重型抓取逻辑。
- watcher 写入 payload 前必须补 `cacheMode: "seeded"`，并写 seed-meta，包括 `lastAttemptAt`、`lastSuccessAt`、`recordCount`、`status`、`sourceStates`、`serviceName`。
- watcher 失败、超时或返回空 items 时，如果存在旧 snapshot，必须 preserve previous snapshot，不能用空结果覆盖。
- API 读取顺序优先为 Redis fresh -> SQLite fresh -> SQLite stale；只有 cold miss 时才允许 live-build fallback，并且要标记 `cacheMode: "live-build"`。
- 配套 systemd service 必须能 `--watch` 常驻，也必须支持不带 `--watch` 的一次性 seed，方便本机和 GCP 验证。
- `system_service.py` 的 seed health 列表必须能观察到新 panel 的 watcher 状态。
- 测试必须覆盖 watcher 存储、preserve previous、API 读 seeded snapshot 不触发 live fetch。

### 5.2 部署边界与代理流量要求

polyData 的部署边界必须清晰区分本机开发服务器和远端 GCP 服务器：

- 本机开发服务器只允许运行 `market`、`orderfilled/trade`、`oracle`、`agent` 相关服务。
- 除上述四类外，新增或修改的 panel watcher / seed service / Telegram publisher / runtime external source service 默认都应该部署并运行在 GCP 服务器上。
- 这些 GCP-side 服务必须使用 GCP 服务器自己的公网出站流量，不能使用本机开发服务器的 Clash / HTTP proxy / SOCKS proxy 流量。
- 新增 watcher 或任何会访问外部数据源的长期服务时，`requests.Session()` 必须显式设置 `trust_env = False`，避免继承 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`http_proxy`、`https_proxy`、`all_proxy`。
- 如果代码必须通过代理访问某个特殊数据源，必须先在实现说明里解释原因，并使用 panel 专属环境变量显式配置；禁止复用本机开发环境的全局代理变量。
- `deploy/systemd/polydata.env.example` 不要新增真实 proxy 配置；不要把本机 shell 里的 proxy 变量复制到 `~/.config/polydata/polydata.env`。
- 新增 systemd service 时必须确认 `WantedBy` / target 与部署角色一致：GCP panel watcher 归属 GCP 侧 target，本机 local collector 只保留 `market/orderfilled/oracle/agent` 边界内的服务。
- 验收时需要确认目标服务实际运行在 GCP，并检查进程环境中没有 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 及小写同名变量。

如果一个 panel 的实现会导致本机误启动 GCP watcher，或让 GCP watcher 继承本机 Clash 流量，该实现不能算完成。

## 6. 测试要求

本机是开发环境，远端 GCP 是测试与验收环境。除非用户明确说只做本地开发，否则不能停在本机。

本机必须完成：

```bash
python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py
cd webpage && npm run build
```

测试至少覆盖：

- API 正常返回
- 连接失败
- timeout
- 非 200
- JSON decode 失败
- 返回格式不符合预期
- items 为空
- 字段缺失
- cache / stale snapshot fallback
- watcher seed 成功写 Redis + SQLite + seed-meta
- watcher 遇到空结果或异常时 preserve previous snapshot
- API 读取 seeded snapshot 时不触发外部 live fetch
- route limit clamp

## 7. 截图 / 视觉验收要求

前端 panel 不能只依赖 `npm run build` 判断完成。每个新增或改动过 UI 的 panel，都必须做截图与 DOM 级视觉验收。

### 7.1 本地截图验收

本地 frontend build 通过后，必须启动本地预览或 dev server，并用 Playwright / Chromium 对包含该 panel 的页面截图。

推荐流程：

```bash
cd webpage
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

然后使用 Playwright 打开页面并保存截图：

```text
artifacts/panel-screenshots/{panel_id}/local-desktop.png
artifacts/panel-screenshots/{panel_id}/local-narrow.png
```

至少覆盖两个 viewport：

```text
desktop: 1440x900
narrow: 390x844
```

如果项目已有 Playwright 测试脚本，优先复用脚本；如果没有脚本，必须使用 Playwright 临时脚本或浏览器自动化完成等价检查，不要只靠人工想象。

### 7.2 DOM 视觉检查

截图之外，还必须在浏览器上下文中检查该 panel 的 DOM。至少检查：

- panel 根节点存在，并且可见
- panel body 不出现横向滚动：`scrollWidth <= clientWidth + 1`
- panel 内没有全局横向 scrollbar
- header title、badge、count、action button 不互相重叠
- 主要文本容器没有明显溢出父容器
- 固定高度 panel 没有被内容撑高破坏 grid
- empty / loading / degraded / stale 状态能正常渲染

如果实现了 Playwright 断言，建议检查类似：

```ts
const panel = page.locator('[data-panel-id="{panel_id}"], .wm-{panel_id}-panel').first();
await expect(panel).toBeVisible();
const overflow = await panel.evaluate((node) => {
  const body = node.querySelector('.wm-panel-body') as HTMLElement | null;
  return body ? body.scrollWidth - body.clientWidth : 0;
});
expect(overflow).toBeLessThanOrEqual(1);
```

如果当前 panel 根节点没有稳定 selector，应在实现时增加稳定 className，必要时增加 `data-panel-id`，方便截图验收。

### 7.3 截图判读要求

截图完成后必须主动打开或检查截图，判断 UI 是否合理。重点看：

- 是否有文字重叠、截断到不可读、挤压成一团
- 是否出现横向滚动条
- 是否出现亮白默认 scrollbar
- panel header 是否被按钮/徽章挤压
- 数据密度是否过低或过高
- 是否符合固定高度 dashboard module，而不是 landing page / 大卡片页面
- mobile/narrow viewport 下是否仍能阅读和滚动

如果截图或 DOM 检查发现问题，必须自动修改 UI 并重新执行：

```text
修改 CSS / layout
-> npm run build
-> 本地截图
-> DOM 检查
```

不能只在最终回答里报告“可能有 UI 问题”。

### 7.4 GCP 公网截图验收

完成 GitHub push、GCP 拉取、静态文件发布、API 重启后，必须对公网地址再做一次截图验收：

```text
artifacts/panel-screenshots/{panel_id}/gcp-desktop.png
artifacts/panel-screenshots/{panel_id}/gcp-narrow.png
```

公网验收必须使用真实线上地址：

```text
http://<gcp-host>/
```

同时验证公网 runtime endpoint：

```bash
curl -sS "http://<gcp-host>{runtime_route}?limit=5"
```

只有当公网截图、DOM 检查、runtime endpoint 都通过，才算视觉验收完成。

如果公网截图失败：

- 先检查静态文件是否 rsync
- 再检查 API runtime payload 是否返回
- 再检查浏览器 console error
- 修复后重新 build / deploy / 截图

### 7.5 最终汇报要求

最终回答必须说明：

- 本地截图保存路径
- GCP 公网截图保存路径
- DOM 检查是否通过
- 是否发现并修复过 UI 挤压、横向滚动、文字重叠
- 如果无法截图，必须说明具体 blocker 和已完成的替代检查

## 8. GitHub 与 GCP 交付要求

完成本机开发后，必须把代码推到 GitHub，再由 GCP 拉取同一 commit。

本机：

```bash
git status --short
git diff --check
git add <本次相关文件>
git commit -m "Add {panel_name} panel"
git push origin HEAD
```

远端 GCP：

- 机器：`<ssh-user>@<gcp-host>`
- 项目目录：`/opt/polyData`

拉取并更新：

```bash
LOCAL_BRANCH="$(git branch --show-current)"
LOCAL_COMMIT="$(git rev-parse --short HEAD)"
ssh <ssh-user>@<gcp-host> "cd /opt/polyData && git fetch origin && git pull --ff-only origin ${LOCAL_BRANCH} && git rev-parse --short HEAD"
```

远端验证：

```bash
ssh <ssh-user>@<gcp-host> 'cd /opt/polyData && .venv/bin/python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py'
ssh <ssh-user>@<gcp-host> 'cd /opt/polyData/webpage && npm run build'
ssh <ssh-user>@<gcp-host> 'sudo rsync -a --delete /opt/polyData/webpage/dist/ /var/www/polydata/'
ssh <ssh-user>@<gcp-host> 'systemctl --user restart polydata-api.service'
ssh <ssh-user>@<gcp-host> 'sudo nginx -t && sudo systemctl reload nginx'
```

如果新增或修改了 watcher / seed service，还必须在 GCP 上启动或重启对应 service，并确认该进程环境中没有代理变量：

```bash
ssh <ssh-user>@<gcp-host> 'systemctl --user restart polydata-{panel_name}-seed.service'
ssh <ssh-user>@<gcp-host> 'pid=$(systemctl --user show polydata-{panel_name}-seed.service -p MainPID --value); test "$pid" != "0" && tr "\0" "\n" </proc/$pid/environ | grep -Ei "^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy)=" && exit 1 || true'
```

公网验收：

```bash
curl -sS http://<gcp-host>/wm-api/health
curl -sS "http://<gcp-host>{runtime_route}?limit=5"
curl -I http://<gcp-host>/
```

公网验收还必须执行第 7 节的 GCP 公网截图验收。

如果远端 `git pull --ff-only` 失败，不要强制 reset；先检查远端工作树状态并报告风险。

## 9. 安全要求

禁止：

- 输出 `.env` 全文
- 在对话里粘贴真实 token、key、secret
- 把真实密钥提交进 git
- 在日志或 curl 输出中回显敏感信息

如果需要检查远端 env，只能检查变量是否存在，不要打印值。

## 10. 完成标准

只有满足以下条件，才算完成：

1. panel 已按现有架构拆分实现
2. 数据源配置已进入 env 体系
3. 前端样式与现有 panel 系统一致
4. panel 可缓存、可降级、可处理网络波动
5. 本机测试通过
6. 本地截图和 DOM 视觉检查通过
7. GitHub 已 push
8. GCP 已拉取同一 commit
9. 远端服务已更新
10. 公网 endpoint 已验收
11. GCP 公网截图和 DOM 视觉检查通过

最终回答必须说明：

- 改了哪些文件
- 本机验证结果
- 本地截图 / DOM 验收结果
- GitHub push 结果
- GCP 更新结果
- 公网验收结果
- GCP 截图 / DOM 验收结果
- 未完成项或风险
