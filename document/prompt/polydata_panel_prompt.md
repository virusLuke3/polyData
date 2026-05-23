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

## 4. 前端实现要求

视觉目标是接近 WorldMonitor 的真实 panel 系统，而不是简单复制某一个已有 panel。

必须遵守：

1. 复用现有 `<Panel />` shell，不要另造外壳。
2. panel 是固定高度的 dashboard module，不允许内容把 panel 撑高，也不允许为了容纳新增内容擅自把 `PanelDefinition.size` 改成 `tall` / `wide`；除非用户明确要求改版式尺寸，否则新增信息必须通过内部布局压缩、body 滚动、分组折叠或减少重复模块解决。
3. body 独立滚动，优先使用细的深色 scrollbar。
4. 信息密度要高，但层级要清楚；不能只是一段白字加几个绿数字。信息型 panel 的首屏必须有至少一个语义 icon / glyph / source mark 作为视觉锚点，icon 要服务于数据含义，例如 sanction shield、macro radar、calendar、oil drop、food basket，而不是装饰性图形。
5. 先判断这个 panel 属于哪一类信息结构，再决定内部布局，例如：
   - feed / news list
   - signal / alert list
   - market row / quote list
   - metric grid
   - calendar / schedule list
   - orderbook / depth
   - status matrix
   - compact table
6. 不要默认套用厚卡片。只有内容本身是 flash / wire / feed 卡片时，才使用卡片化结构。
7. 不要让所有状态都只靠绿色表达。必须使用多层颜色表达重点、风险、异常、状态差异。
8. metadata、badge、timestamp、symbol、id 使用紧凑 mono 风格；正文和标题保持可读，不要所有文字都高字重。
9. 颜色、边框、间距、标题大小必须与现有 panel 系统一致，优先复用已有变量和样式语义。
10. panel 内部不能出现横向滚动；如果内容较多，重排结构，不要硬塞宽表格。

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

新增或改动 panel 时，必须先参考 WorldMonitor 的真实前端实现方式，但不要照抄某个具体业务 panel。要吸收的是它的视觉系统：

```text
小字号 mono 体系
暗底细边框
行级语义 icon
右侧状态 badge
表格化 / registry 化扫描结构
少量但职责明确的颜色
点击 row 后用 drawer 承载细节
```

#### 4.2.1 字体层级

panel 内字体必须有明确层级，不允许所有文字都使用同样大小和字重。

推荐层级：

| 用途 | 建议 |
|---|---|
| panel title | 11-12px, uppercase, 600-700, letter-spacing 0.08em 左右 |
| hero signal | 13-16px, 700, 只给最重要的一句话 |
| row title | 11-12px, 600, 可读但不夸张 |
| row meta / source | 9-10px, uppercase, dim color, letter-spacing 0.04-0.08em |
| numeric value | 14-18px, tabular-nums, 600-700 |
| badge / chip | 8-10px, uppercase, 700 |
| table header | 9px, uppercase, dim color |

要求：

- 数值必须使用 `font-variant-numeric: tabular-nums`，保证扫描稳定。
- 不要把正文、meta、badge 全部做成粗体。
- 不要用 hero 级字号塞进 compact row 或 chip。
- 中文界面也要保留清晰层级，不要因为中文更占宽就加大字号。

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
| red / coral | hot CPI, inflation up, hawkish, critical risk, upside shock |
| green / teal | cool CPI, disinflation, dovish, ok, positive freshness |
| amber / yellow | watch, mixed, event risk, uncertainty, stale warning |
| blue | official, verified source, model/info |
| purple | Polymarket odds, market gap, trading layer |
| gray | degraded, stale, fallback, unavailable, neutral meta |

要求：

- 一个 panel 不能只靠绿色表达所有状态。
- 不要大面积使用高饱和背景；高饱和色只用于 badge、delta、accent border、icon glow。
- 同一语义在不同 panel 内保持一致，比如 PMKT 永远偏 purple，official 永远偏 blue。
- 数据缺失 / degraded 只能用 gray / amber，不能用 red 伪装成真实风险信号。
- trend delta 要有方向色：hot/upside 与 cool/downside 分开表达。

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
| 需要解释细节 | row click drawer |

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

#### 4.2.6 Badge / Chip / 状态件

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

#### 4.2.7 Macro / CPI Panel 专用视觉映射

开发 CPI macro panel 时，必须固定以下视觉语言：

| 主题 | icon/glyph 方向 | 主色 |
|---|---|---|
| CPI / inflation | gauge / thermometer / CPI mark | red/green by hot/cool |
| Core / services | core ring / service mark | red/amber |
| Energy | oil drop / gas pump / barrel | coral/red or green |
| Food | basket / food component glyph | amber/red/green |
| Shelter | home / rent receipt / lag arrow | red/green/amber |
| Labor | worker / wage / claims / services | red/green/amber |
| Growth | pulse / retail cart / factory | green/red/amber |
| Fed / rates | Fed building / curve / rate ladder | red/green/blue |
| Policy / tariff | shield / document / container ship | red/blue/amber |
| Polymarket | PMKT / market route / odds chip | purple |

每个 CPI macro panel 的主视图至少包含：

```text
1 个 hero semantic icon
1 条 primary signal
2-5 条 ranked/registry rows
1 个 source/freshness 状态
1 个 PMKT 关联位，如果该 panel 已接入 market layer
```

#### 4.2.8 WorldMonitor 级视觉验收口径

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
