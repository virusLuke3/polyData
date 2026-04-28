# polyData 新增 Panel 可复用 Prompt

本文档用于后续在 `polyData / polymonitor` 中新增任何 dashboard panel。使用方式：把第 6 节的 prompt 直接复制给开发 Agent，并把 `{panel_id}`、`{panel_name}`、`{data_source}` 等占位符替换成实际需求。

## 1. polyData 现有 panel 代码审查结论

### 1.1 前端分层

当前前端 panel 不是写在单一大文件中，而是通过模块注册：

- Panel 外壳：`webpage/src/components/Panel.tsx`
- Panel 样式：`webpage/src/styles/panels.css`、`webpage/src/styles/main.css`
- Panel 注册表：`webpage/src/panels/modules/index.ts`
- Panel 类型与刷新配置：`webpage/src/panels/types.ts`
- API client：`webpage/src/services/api.ts`
- 每个 panel 模块：`webpage/src/panels/modules/<panel-id>/index.ts`

当前约定是：新增 panel 必须创建独立 module，并导出 `panel`；不能在 `App.tsx` 增加新的 per-panel `useState`、fetch、setRuntime 逻辑。运行时 panel 使用 `runtimePanelFromRenderer(...)` 声明 `fetchData` 和 `refresh.tier`。

### 1.2 后端分层

后端 runtime panel 也已经模块化：

- Runtime panel registry：`scripts/api/runtime_panels/registry.py`
- Runtime panel 类型：`scripts/api/runtime_panels/types.py`
- Runtime panel route 自动注册：`scripts/api/routes/runtime_panels.py`
- 每个后端 panel module：`scripts/api/runtime_panels/modules/<panel_name>.py`
- 复杂业务逻辑应放在 service 或独立客户端中，不应塞进 route 文件。

每个后端 runtime panel module 需要声明：

```py
PANEL_ID = "example-panel"
ROUTE = "/runtime/example/panel"
DEFAULT_LIMIT = 8
MIN_LIMIT = 1
MAX_LIMIT = 20

def get_snapshot(ctx: dict, *, limit: int = DEFAULT_LIMIT) -> dict:
    ...
```

### 1.3 配置与数据源特点

数据源配置集中在：

- `scripts/data_sources.py`
- `scripts/api/config.py`
- 本地 `.env` / `.env.local`
- 远端 GCP systemd env：`~/.config/polydata/polydata.env`
- 示例文件：`deploy/systemd/polydata.env.example`

当前代码已经有明确规则：外部 API URL、密钥、token、app id、proxy、数据库连接都不应硬编码在业务代码中，应从环境变量读取。`.gitignore` 已忽略 `.env`、`.env.local`、`secrets/`、`document/`。

### 1.4 缓存与抗波动特点

polyData 的 runtime 数据不是简单实时直连前端，而是通过缓存与 snapshot 保护：

- Redis：`POLYDATA_REDIS_URL`
- Redis prefix：`POLYDATA_REDIS_PREFIX`
- SQLite snapshot store：`POLYDATA_SNAPSHOT_SQLITE_PATH`
- 通用 snapshot helper：`scripts/api/cache.py`
- 典型模式：Redis hit -> SQLite fresh hit -> stale hit + background refresh -> builder cold fetch

新增 panel 应优先接入这个模式。网络波动、上游 API 暂时无数据、返回空数组时，不能让前端崩溃，也不能用空结果覆盖已有可用 stale snapshot。

### 1.5 视觉特点

polyData 当前 panel 视觉继承 WorldMonitor 风格，但已经有自己的落地样式：

- 深色背景：`#090909`、`#101010`、`#141414`、`#161616`
- 边框：`#232323`、`#252525`、`#2a2a2a`
- 主文字：`#f3f3f3`
- 次级文字：`#8f8f8f`、`#8d918e`
- 强信号绿：`#39ff73` / `#22c55e`
- 警示色：`#ff4b4b`、`#ff8f24`、`#f6b61f`
- 字体：正文 `SF Pro Display / Segoe UI / sans-serif`，元信息 `SF Mono / Monaco / Cascadia Code / monospace`

截图中的 `MARKETS` 和 `JIN10` panel 是 polyData 当前最接近目标的基准，但不能把它们当成所有 panel 的唯一模板。它们主要提供 shell、header、count、内部滚动、紧凑卡片的参考。

当新增 panel 属于 `flash-card` / 快讯类时，外观应贴近 JIN10 panel：

- 桌面视觉验收目标：外层 panel 使用 JIN10 当前比例，约 `508px` 宽、`463px` 高。
- 在 dashboard grid 中仍应继承现有 grid slot，但内部布局要按这个固定比例设计，避免内容撑高或塌陷。
- Header 高度约 `40px`。
- Body 内边距约 `8px`。
- 卡片最小高度约 `90px-100px`。
- 卡片间距约 `5px-6px`。
- 元信息字号约 `10px-11px`，标题字号约 `12px-13px`，底部强数字约 `12px`。

### 1.6 2026-04-28 WorldMonitor 对比后的前端差距结论

本地 `worldmonitor` 代码审查后，新增 panel 的前端提示词必须修正一个误区：不能把 JIN10 卡片当成所有 panel 的默认答案。JIN10 是 `flash-card` 语法，只适合快讯、wire、BWE/Jin10/news flash。WorldMonitor 的好看来自“统一 panel shell + 不同 panel grammar”，不是所有内容都套厚卡片。

WorldMonitor 的真实关键点：

- Grid 更像固定仪表盘模块：
  - `.panels-grid` 使用 `grid-auto-rows: minmax(200px, 380px)`
  - 每个 `.panel` 是 `height:100%`、`overflow:hidden`、`display:flex`
  - `.panel-content` 内部滚动，不让内容撑高 panel
- Shell 更完整：
  - header 左侧有 title / info / severity / PRO 等小控件
  - header 右侧有 live/cached badge、count、close/collapse 等小控件
  - 底部和右侧 resize handle 形成微妙蓝黑 edge gradient
- 内部语法更丰富：
  - news 是薄 divider rows，不是满边框卡片
  - market/crypto 是 ticker rows 或小 metric tiles
  - signal 是 4px severity rail + chips + 一句 summary
  - macro/positioning 是 metric bars / compact tables
  - sports 是 grouped match cards
  - system 是 status matrix

当前 polyData 视觉差距的主要原因：

- `.wm-panels-grid` 行高偏短：`minmax(160px, 260px)`，导致面板像被压扁，内部又用高卡片补空间。
- 很多 panel 复用 JIN10 厚卡片/绿 rail，导致视觉同质化。
- 字体和 letter-spacing 太重；WorldMonitor 的 metadata 多为 9-10px muted，不是所有文字都 800 weight。
- 亮色默认 scrollbar 太显眼；应使用 4px dark scrollbar。
- feed 类内容使用太多 full bordered cards；WorldMonitor 更常用 row divider。
- 空状态和稀疏数据状态不够“设计化”。

后续新增 panel 必须先选择视觉 grammar：

- `news-row`：source/headline/time，薄分割线，alert 时才有左 rail。
- `signal-rail`：4px severity rail、index、type chip、severity badge、summary。
- `market-row`：名称/符号、mini sparkline、price/change，少边框。
- `commodity-grid`：2-3 列 compact metric tiles。
- `calendar-list`：按日期/赛事分组的紧凑 rows。
- `orderbook-depth`：YES/NO 或 bid/ask ladder，depth fill bars。
- `status-matrix`：服务名、状态 pill、更新时间/延迟。
- `metric-bars`：label/value + horizontal bars。
- `table-monitor`：紧凑表格，适合 registry / rank / country data。
- `funding-pressure-board`：资金费率/多空压力类窄面板，rank + identity + tone badge，指标放进二级 metric tiles。
- `funding-venue-heatmap`：按资产聚合、按交易所展开的 funding rate heatmap，突出 longs pay / shorts pay / venue spread。
- `flash-card`：JIN10/BWE 类快讯卡片，只在确实是 wire feed 时使用。

### 1.7 Funding panel 复盘后的视觉规则

2026-04-28 对 `crypto-funding-watch` 的修复说明了一个重要问题：WorldMonitor 好看的原因不是“表格列很多”，而是它会根据 panel 宽度选择合适的信息形态。窄 dashboard panel 不能硬塞 6-7 列表格。

Funding 旧实现的问题：

- 行使用 7 列 CSS grid，表头使用 6 列 CSS grid，列结构天然不对齐。
- `minmax(92px...)`、`minmax(102px...)` 等固定最小宽度叠加后超过 panel 宽度，必然出现横向 scrollbar。
- rank、market、funding、annualized、reset、tone 全在一行里争抢空间，导致文字重叠。
- 颜色只落在 funding 数字上，normal 数据全是绿色，看不到重点、风险等级、异常方向。
- 默认亮白 scrollbar 破坏深色 dashboard 质感。

Funding 修复后的正确模式：

- 使用 `funding-pressure-board` grammar，不使用宽表格。
- Summary 顶部是 3-4 个紧凑 metric tiles：Assets / Venues / Max Abs / Pressure。
- 这些 metric tiles 默认使用 2 列；不要因为桌面 viewport 很宽就假设单个 panel 也很宽。
- 列表行使用两列主结构：`rank` + `content`。
- 行内顶部显示 asset、exchange/symbol、tone badge。
- funding、annualized、mark、reset 放入二级 metric tiles，不放在同一横向表格行里。
- 行左侧用 3px rail 和轻微 tint 标示等级：
  - critical：红
  - warning：黄/橙
  - negative：蓝
  - normal：绿
  - neutral：灰
- 每个 metric tile 的 label 8-9px muted，值 11-12px mono strong。
- panel body 必须 `overflow-x: hidden`，内部不得出现横向 scrollbar。
- scrollbar 必须是 dark thin scrollbar。
- 响应式判断要基于 panel slot 的真实窄宽度；如果没有 container query，就优先选择更稳的 2 列布局，不要只写 viewport media query。

这条规则适用于所有窄 panel 中的 ranking / funding / positioning / leaderboard 类内容：如果列宽合计超过 panel slot，就不要做横向表格，改成 row + nested metrics。

### 1.8 Funding rate 语义合同

新增或重做 funding 类 panel 时，Codex 必须先理解 funding rate 的金融含义，而不是把它当成普通价格列表：

- funding rate 是永续合约多空之间的周期性资金费支付，不是 spot price。
- 正 funding：
  longs pay shorts，通常代表多头更拥挤。
- 负 funding：
  shorts pay longs，通常代表空头更拥挤。
- 同一资产在不同交易所的 funding rate 不一定相同。
- venue 之间的差异本身就是信号：
  可能表示拥挤方向不一致、基差错位、流动性差异，或者上游更新不同步。
- 如果上游给的是多交易所 funding 数据，panel 不能把它压扁成单一 funding 数字。
- 正确的展示单位应优先是：
  资产行 + venue quotes，而不是 quote 行 + 单 venue 文本卡片。
- funding panel 应重点表达四类信息：
  - 同一资产在不同 venue 的 funding 值
  - 当前共识方向：`longs pay` / `shorts pay` / `mixed`
  - venue spread
  - next reset / funding window
- 颜色合同：
  - 正 funding 用暖色系：橙 / 红
  - 负 funding 用冷色系：青 / 蓝
  - mixed / venue disagreement 用黄
  - neutral / flat 用灰
- 不要把 funding panel 做成只有白字和绿色数字的“伪实时列表”。

### 1.9 Funding refresh 合同

Funding 类 panel 不能看起来像“只有手动刷新才动”的假 live 面板。

- 前端轮询周期和后端 TTL 必须一起设计。
- 如果前端 `intervalMs` 比 TTL 短很多，而后端 TTL 又过长，用户看到的仍然是旧数据。
- 对 funding 这种快变但不需要 tick 级更新的数据，推荐：
  - 前端轮询 `10s-15s`
  - 后端 TTL `10s-15s`
- 不要只在 panel module 里声明 `intervalMs` 就结束；还要确认 App 的 runtime refresh 机制真的会按这个 interval 拉取。
- 如果项目里只有某些 panel 需要独立轮询，应该像 `crypto-watch` 一样接入自定义刷新，而不是等全局 slow refresh。

## 2. 新增 panel 必须遵守的工程规则

1. 不能把所有代码放进一个脚本。
2. 前端 module、API client、类型定义、CSS、后端 runtime module、service/client、测试必须按职责拆开。
3. 不能在 `App.tsx` 增加 panel 专属状态刷新逻辑。
4. 不能在 `scripts/api/routes/runtime_panels.py` 写 panel 专属 route；应该注册到 backend runtime registry。
5. 所有数据源 URL、密钥、token、app id、header secret、proxy 都必须进入 `.env` / 远端 `~/.config/polydata/polydata.env`，并在 `deploy/systemd/polydata.env.example` 写占位符。
6. 代码中只允许读取环境变量名，不允许提交真实密钥或真实私有 endpoint。
7. 外部数据必须先验证可连接、格式稳定、可缓存、可降级，再接入前端。
8. 测试必须区分本机开发和远端 GCP 验收。本机是开发环境，远端 GCP 是最终测试环境。
9. 除非用户明确说“只做本地开发，不部署远端”，新增 panel 的完成状态必须包括：本机代码提交并推送到 GitHub、GCP 远端拉取同一 commit、远端服务更新、远端公网 endpoint 验收。

## 3. 新增 panel 的推荐文件清单

前端：

- `webpage/src/panels/modules/{panel_id}/index.ts`
- `webpage/src/services/api.ts`
- `webpage/src/types.ts`
- `webpage/src/styles/panels.css`
- 如需要独立 renderer，可新增 `webpage/src/panels/{domain}-panels.tsx` 或在 module 内实现。
- 在 `webpage/src/panels/modules/index.ts` 注册。

后端：

- `scripts/api/runtime_panels/modules/{panel_name}.py`
- `scripts/api/runtime_panels/registry.py`
- `scripts/api/config.py`
- `scripts/data_sources.py`
- 如需要复杂抓取逻辑，新增 `scripts/api/services/{panel_name}_service.py` 或 `scripts/{domain}/{panel_name}.py`
- `deploy/systemd/polydata.env.example`

测试：

- `tests/test_runtime_panel_registry.py`
- `tests/test_{panel_name}.py`
- 必要时增加前端 build 验证：`cd webpage && npm run build`

## 4. 数据源接入检查清单

新增数据源前先回答：

- 数据源是公开 API、需要 key 的 API、网页抓取、RSS，还是数据库内部数据？
- 是否允许缓存？缓存 TTL 应是多少？
- 是否有速率限制？是否需要 User-Agent、API key、app id、token、proxy？
- 返回格式是否稳定？字段缺失时如何降级？
- API 暂时失败时是否能返回 stale snapshot？
- 数据为空时，是正常空状态，还是上游失败？
- 远端 GCP 能否访问该数据源？是否需要 `HTTP_PROXY` / `HTTPS_PROXY`？

必须新增或确认的环境变量：

```bash
POLYDATA_{PANEL_NAME}_API_URL=
POLYDATA_{PANEL_NAME}_API_KEY=
POLYDATA_{PANEL_NAME}_SOURCE_URL=
POLYDATA_{PANEL_NAME}_TTL_SECONDS=
```

只填写真实值到本机 `.env` 和远端 `~/.config/polydata/polydata.env`。`deploy/systemd/polydata.env.example` 只能写空值或 `REPLACE_ME`。

## 5. 测试与远端 GCP 安全要求

### 5.1 本机开发测试

本机只做开发与构建验证：

```bash
python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py
cd webpage && npm run build
```

本机测试要覆盖：

- API 能否连接。
- HTTP timeout / 非 200 / JSON decode 失败时是否降级。
- 返回格式是否符合前端类型预期。
- `items` 是否为数组。
- 有数据、无数据、字段缺失、网络波动四种情况。
- cache key 是否包含影响结果的参数。
- stale snapshot 是否不会被空结果覆盖。

### 5.2 为什么旧流程容易漏掉 GCP 验收

旧 prompt 的问题是：只写了远端健康检查命令，没有把“本机代码如何进入 GCP”定义成必须步骤。因此执行者可能完成本机测试、启动本地服务、验证 `127.0.0.1:18500` 后就停止，并在最终回答中说“远端 GCP 未部署”。这不符合 polyData 的真实交付路径。

正常交付链路应是：

```text
本机开发
-> 本机测试 / build
-> git commit
-> git push origin <branch>
-> ssh 到 GCP
-> /opt/polyData 拉取同一 branch / commit
-> 更新远端依赖或环境变量
-> 远端 build / 静态文件同步
-> 重启 polydata-api.service / 必要时 reload nginx
-> 通过公网 /wm-api 验收
```

除非用户明确暂停远端部署，否则“远端 GCP 没有部署或验收”不能作为正常完成状态。

### 5.3 本机同步到 GitHub

在本机完成开发和测试后，必须把可部署代码推送到远端 GitHub 仓库。当前仓库 remote 是：

```bash
origin git@github.com:virusLuke3/polyData.git
```

推荐流程：

```bash
git status --short
git diff --check
python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py
cd webpage && npm run build
```

提交时只加入本次 panel 相关文件，不要把无关本地改动一起提交：

```bash
git add <本次新增或修改的代码文件>
git diff --cached -- . ':!.env' ':!.env.local'
git commit -m "Add {panel_name} panel"
git push origin HEAD
```

如果工作区有用户的无关改动，不能 reset、checkout 或覆盖。只提交本次相关文件；如果无法安全区分，先停下来说明风险。

### 5.4 GCP 拉取代码并更新服务

远端 GCP 信息来自 `document/新GCP远端服务控制手册.md`：

- 远端机器：`jhuaiyu3@34.143.254.155`
- 远端目录：`/opt/polyData`
- API：Gunicorn + Nginx，`/wm-api/ -> 127.0.0.1:18500`
- Redis：`redis://127.0.0.1:6379/0`
- 远端是测试与验收环境，不是本机开发环境。

远端更新必须通过 SSH 控制 GCP 拉取 GitHub 上的代码，而不是只在本机启动服务。推荐流程如下。

先确认远端仓库状态：

```bash
ssh jhuaiyu3@34.143.254.155 'cd /opt/polyData && git status --short && git branch --show-current && git rev-parse --short HEAD'
```

拉取本机刚推送的 branch。默认使用本机当前 branch；如果远端固定使用 `main` 或其他 branch，以实际部署 branch 为准：

```bash
LOCAL_BRANCH="$(git branch --show-current)"
LOCAL_COMMIT="$(git rev-parse --short HEAD)"
ssh jhuaiyu3@34.143.254.155 "cd /opt/polyData && git fetch origin && git pull --ff-only origin ${LOCAL_BRANCH} && git rev-parse --short HEAD"
```

如果远端 `git pull --ff-only` 失败，不能强制 reset。先查看远端状态并报告：

```bash
ssh jhuaiyu3@34.143.254.155 'cd /opt/polyData && git status --short && git log --oneline -5'
```

远端依赖与 build：

```bash
ssh jhuaiyu3@34.143.254.155 'cd /opt/polyData && python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py'
ssh jhuaiyu3@34.143.254.155 'cd /opt/polyData/webpage && npm ci && npm run build'
```

如果远端 Nginx 服务的是 `/var/www/polydata` 静态目录，build 后必须同步前端产物：

```bash
ssh jhuaiyu3@34.143.254.155 'sudo rsync -a --delete /opt/polyData/webpage/dist/ /var/www/polydata/'
```

如果只改后端 API，也仍应确认前端静态文件是否需要更新；新增 panel 通常前后端都要更新。

更新服务：

```bash
ssh jhuaiyu3@34.143.254.155 'systemctl --user restart polydata-api.service'
ssh jhuaiyu3@34.143.254.155 'systemctl --user status polydata-api.service --no-pager'
ssh jhuaiyu3@34.143.254.155 'sudo nginx -t && sudo systemctl reload nginx'
```

### 5.5 远端 GCP 验收与安全要求

远端测试命令必须避免泄露密钥。不要输出 `.env` 全文，不要把 secret 写进日志，不要在最终回答中粘贴 token。

推荐远端检查：

```bash
ssh jhuaiyu3@34.143.254.155 'systemctl --user status polydata-api.service --no-pager'
curl -sS http://34.143.254.155/wm-api/health
curl -sS "http://34.143.254.155/wm-api/{runtime_route}?limit=5"
curl -I http://34.143.254.155/
```

如果需要检查环境变量是否存在，只能做布尔检查：

```bash
ssh jhuaiyu3@34.143.254.155 'grep -q "^POLYDATA_{PANEL_NAME}_API_URL=" ~/.config/polydata/polydata.env && echo present || echo missing'
```

禁止：

- `cat ~/.config/polydata/polydata.env`
- 在对话中粘贴真实 API key。
- 在代码、文档、测试 fixture 中提交真实密钥。
- 在 curl 命令中把 token 放到 URL query 并回显。

如果远端环境变量缺失：

- 只能提示需要在 `~/.config/polydata/polydata.env` 增加哪些变量名。
- 不能要求用户把 secret 发到对话里。
- 如果你有权限修改远端 env，也只能用不回显 secret 的方式写入，并随后重启 API。

## 6. 可复制复用 Prompt

```text
你正在为 polyData / polymonitor 新增一个 dashboard panel：{panel_name}，panel id 为 `{panel_id}`。

请先审查现有代码，再实现。必须遵守 polyData 当前架构，不要把所有代码塞进一个脚本或一个大文件。

参考文档和代码：
- document/polydata_panel_prompt.md
- document/worldmonitor_panel_prompt.md
- document/新GCP远端服务控制手册.md
- docs/panel-modules.md
- webpage/src/components/Panel.tsx
- webpage/src/styles/panels.css
- webpage/src/styles/main.css
- webpage/src/panels/modules/jin10-flash/index.ts
- webpage/src/panels/jin10-panels.tsx
- scripts/api/runtime_panels/registry.py
- scripts/api/routes/runtime_panels.py
- scripts/api/cache.py
- scripts/api/config.py
- scripts/data_sources.py

目标：
新增一个可复用、可缓存、可测试、可在远端 GCP 验收的 polyData panel。它的数据源是：{data_source}。它要展示：{display_goal}。

一、前端样式要求
1. 新 panel 必须视觉上接近 WorldMonitor 的真实 panel 系统，而不是只复制 JIN10 卡片。
2. 先为 `{panel_id}` 选择一个 visual grammar，并在实现说明中写明：
   - `news-row`
   - `signal-rail`
   - `market-row`
   - `commodity-grid`
   - `calendar-list`
   - `orderbook-depth`
   - `status-matrix`
   - `metric-bars`
   - `table-monitor`
   - `funding-pressure-board`
   - `funding-venue-heatmap`
   - `flash-card`
3. 只有当 `{panel_id}` 是快讯、wire、BWE/Jin10 类内容时，才使用 `flash-card` / JIN10 厚卡片。不要默认使用 JIN10 风格。
4. Panel 外层使用现有 `<Panel />` shell，不要另造一套 panel 外壳。
5. 桌面视觉验收尺寸：
   - 单 panel slot 应像 WorldMonitor module：固定高度、内部滚动、内容裁切。
   - 如果是普通 dashboard panel，优先按 WorldMonitor 的 `200px-380px` 行高思路设计。
   - 如果是 JIN10/flash panel，可使用约 `508px` 宽、`463px` 高的当前比例。
6. Header：
   - 高度约 40px。
   - 左侧 mono uppercase title，例如 `{panel_short_title}`。
   - title 字号 11-12px，font-weight 700-800，letter-spacing 1-2px。
   - title 旁边可使用 LIVE / ACTIVE / API / ESPN / FED 等 badge；不要所有 badge 都强行绿色。
   - 右侧 count badge 使用深色背景，宽约 28-36px，高约 20-24px。
   - 如该 panel 有数据新鲜度，增加 live/cached/degraded 小状态。
7. Body：
   - padding 约 8px。
   - 独立滚动，不能撑高页面。
   - feed 类内容优先用薄 divider rows：`padding: 8px 0`、`border-bottom`。
   - 只有 metric tile / flash card / orderbook side / designed empty state 才使用 full bordered cards。
   - 使用 4px 或更细的 dark scrollbar，不要出现亮白默认 scrollbar。
8. 按 grammar 实现内部结构：
   - `news-row`：9-10px source/meta，12px headline，9px time，alert 才有 2px left rail。
   - `signal-rail`：4px severity rail，index，type chip，severity badge，theater/age pill，12px summary。
   - `market-row`：name/symbol 左侧，mini sparkline + price/change 右侧，row divider，不用厚卡片。
   - `commodity-grid`：2-3 列小 tile，9px uppercase label，14-18px strong value，10px change。
   - `calendar-list`：按赛事/日期分组，右侧状态或比分，行高紧凑。
   - `orderbook-depth`：YES/NO 或 bid/ask 分栏，spread/depth 顶部指标，ladder 行带 fill bar。
   - `status-matrix`：服务名、状态 pill、更新时间/延迟，行式矩阵。
   - `metric-bars`：label/value + horizontal bar，对比关系要可视化。
   - `table-monitor`：紧凑 columns，适合 registry/ranking/country 数据。
   - `funding-pressure-board`：rank + identity + tone badge 在第一层，funding/annualized/price/reset 放入二级 metric tiles；禁止横向宽表格。
   - `funding-venue-heatmap`：按资产聚合，同一资产下渲染多个 venue funding cells；必须显示 venue 差异、bias、spread、reset，不能压成单一 funding 值。
   - `flash-card`：参考 JIN10/BWE，卡片 min-height 90-100px，间距 5-6px，2px left rail。
9. 颜色：
   - 背景：`#0a0a0a`, `#101010`, `#141414`, `#151515`, `#161616`
   - 边框：`#1a1a1a`, `#232323`, `#242424`, `#252525`, `#2a2a2a`
   - 主文字：`#e8e8e8` / `#f3f3f3`
   - 次级文字：`#888`, `#8f8f8f`, `#8d918e`
   - live/positive：`#44ff88`, `#39ff73`, `#22c55e`
   - critical/high/watch：`#ff4444`, `#ef4444`, `#f97316`, `#ffaa00`
10. 字体：
   - 正文继承 `--font-body`
   - metadata、badge、数字、hash、timestamp 使用 `--font-mono`
   - 不要所有文字都 `font-weight: 800`。
   - metadata 通常 9-10px muted；title 通常 11-12px；强指标才使用 14-18px。
11. 必须避免的错误：
   - landing page 风格。
   - 大卡片套小卡片。
   - 大段解释性文字。
   - oversized hero。
   - 对所有 panel 使用同一种 JIN10 厚卡片。
   - feed 类内容全都做 full bordered cards。
   - 所有状态都用绿色。
   - 默认白色 scrollbar。
   - 在 480px 左右宽度的 panel 中硬塞 6-7 列表格。
   - 表头 grid 和数据行 grid 的列数、列宽不一致。
   - 因固定最小列宽导致横向滚动和文字错位。
   - 把多交易所 funding 数据压扁成单 venue 排行榜。
   - funding panel 仍然只有白色和绿色，无法区分正 funding / 负 funding / mixed。
   - 前端写了 `intervalMs`，但 App 并没有真正按这个 interval 轮询。
   - 后端 TTL 远大于前端轮询，导致“看起来实时，实际不动”。
   - 用加大 padding 假装高级。
   - panel 高度随数据无限增长。

二、数据源与环境变量要求
1. 先判断 `{data_source}` 是否可用、是否稳定、是否能缓存、是否有速率限制。
2. 所有数据源 URL、API key、token、app id、secret、proxy 都必须从环境变量读取。
3. 修改：
   - scripts/data_sources.py
   - scripts/api/config.py
   - deploy/systemd/polydata.env.example
4. 真实密钥只允许写入本机 `.env` 或远端 `~/.config/polydata/polydata.env`，不能提交。
5. env 命名使用：
   - POLYDATA_{PANEL_NAME}_API_URL
   - POLYDATA_{PANEL_NAME}_API_KEY
   - POLYDATA_{PANEL_NAME}_SOURCE_URL
   - POLYDATA_{PANEL_NAME}_TTL_SECONDS
6. 对外请求必须有 timeout。
7. API 失败、网络波动、返回空数据、字段缺失时必须返回可渲染 payload，而不是抛给前端崩溃。
8. 使用现有 snapshot/cache 模式：
   - Redis 优先。
   - SQLite snapshot 兜底。
   - stale hit 时异步 refresh。
   - 不要用空 items 覆盖已有可用 snapshot。

三、代码开发要求
前端必须拆分：
1. 创建 `webpage/src/panels/modules/{panel_id}/index.ts`。
2. 在 `webpage/src/panels/modules/index.ts` 注册。
3. 在 `webpage/src/services/api.ts` 添加 `fetchRuntime{PanelName}`。
4. 在 `webpage/src/types.ts` 添加 runtime payload 类型。
5. 在 `webpage/src/styles/panels.css` 添加 `{panel_id}` 专属 CSS，先复用 shared shell，再按已选择的 visual grammar 写内部结构。不要默认复用 `wm-jin10-panel`。
6. 如果需要 renderer，优先在 module 内或独立 `{domain}-panels.tsx` 中实现，避免扩大旧大文件。
7. 不要在 `App.tsx` 添加 panel 专属刷新逻辑；只在确实需要类型化 runtime context 时做最小改动。

后端必须拆分：
1. 创建 `scripts/api/runtime_panels/modules/{panel_name}.py`。
2. 在 `scripts/api/runtime_panels/registry.py` 导入并注册。
3. 如果有复杂抓取/清洗逻辑，放到 `scripts/api/services/{panel_name}_service.py` 或 `scripts/{domain}/{panel_name}.py`。
4. Route 由 `scripts/api/routes/runtime_panels.py` 自动注册，不要新增 one-off route。
5. payload 结构建议：
   {
     "generatedAt": "...",
     "source": "{source}",
     "sourceUrl": "...",
     "status": "ok|degraded|empty|invalid",
     "items": [...]
   }

四、测试要求
本机开发测试：
1. 新增或更新 `tests/test_{panel_name}.py`。
2. 覆盖：
   - API 正常返回。
   - API 连接失败。
   - timeout / 非 200 / JSON decode 失败。
   - 返回格式不符合预期。
   - items 为空。
   - 字段缺失。
   - stale snapshot / cache fallback。
   - route limit clamp。
3. 运行：
   - `python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py`
   - `cd webpage && npm run build`

远端 GCP 验收：
1. 本机是开发环境，远端 GCP 才是测试/验收环境。除非用户明确说只做本地开发，否则必须完成远端部署和验收，不能停在本机 endpoint。
2. 远端机器：`jhuaiyu3@34.143.254.155`
3. 远端项目：`/opt/polyData`
4. 先把本机开发代码同步到 GitHub：
   - `git status --short`
   - `git diff --check`
   - 确认 `.env`、secret、token 没有进入 git。
   - `git add <本次 panel 相关文件>`
   - `git commit -m "Add {panel_name} panel"`
   - `git push origin HEAD`
5. SSH 到 GCP，让远端从 GitHub 拉取同一 branch / commit：
   - `LOCAL_BRANCH="$(git branch --show-current)"`
   - `LOCAL_COMMIT="$(git rev-parse --short HEAD)"`
   - `ssh jhuaiyu3@34.143.254.155 "cd /opt/polyData && git fetch origin && git pull --ff-only origin ${LOCAL_BRANCH} && git rev-parse --short HEAD"`
   - 远端 `rev-parse --short HEAD` 必须等于或明确对应本机 `LOCAL_COMMIT`。
6. 远端运行必要测试和 build：
   - `ssh jhuaiyu3@34.143.254.155 'cd /opt/polyData && python -m pytest tests/test_runtime_panel_registry.py tests/test_{panel_name}.py'`
   - `ssh jhuaiyu3@34.143.254.155 'cd /opt/polyData/webpage && npm ci && npm run build'`
7. 如果前端由 `/var/www/polydata` 提供静态文件，必须同步 dist：
   - `ssh jhuaiyu3@34.143.254.155 'sudo rsync -a --delete /opt/polyData/webpage/dist/ /var/www/polydata/'`
8. 更新服务：
   - `ssh jhuaiyu3@34.143.254.155 'systemctl --user restart polydata-api.service'`
   - `ssh jhuaiyu3@34.143.254.155 'sudo nginx -t && sudo systemctl reload nginx'`
9. 检查 API 服务：
   - `ssh jhuaiyu3@34.143.254.155 'systemctl --user status polydata-api.service --no-pager'`
10. 检查健康：
   - `curl -sS http://34.143.254.155/wm-api/health`
11. 检查新 endpoint：
   - `curl -sS "http://34.143.254.155/wm-api/{runtime_route}?limit=5"`
12. 检查首页静态服务：
   - `curl -I http://34.143.254.155/`
13. 只允许检查 env 是否存在，不允许输出密钥：
   - `ssh jhuaiyu3@34.143.254.155 'grep -q "^POLYDATA_{PANEL_NAME}_API_URL=" ~/.config/polydata/polydata.env && echo present || echo missing'`
14. 禁止 `cat ~/.config/polydata/polydata.env`，禁止在最终回答中粘贴任何 secret。

如果远端环境变量缺失：
- 只能提示需要在 `~/.config/polydata/polydata.env` 增加哪些变量名。
- 不能要求用户把 secret 发到对话里。
- 如果你有权限修改远端 env，也只能用不回显 secret 的方式写入，并随后重启 API。

五、交付物
完成后请汇报：
1. 修改了哪些文件。
2. 新增 panel 的 route、env 变量名、cache TTL。
3. 本机测试结果。
4. GitHub push 结果：branch、commit。
5. GCP 拉取结果：远端 branch、远端 commit。
6. GCP 服务更新结果：API restart、Nginx reload、静态文件同步。
7. 远端 GCP 验收结果：`/health`、新 `/wm-api/{runtime_route}`、首页。
8. 是否存在上游数据不稳定、无数据、格式变化、密钥未配置等风险。
```

## 7. 新 panel 完成标准

一个新增 panel 只有同时满足以下条件，才算完成：

- 前端视觉接近 WorldMonitor 真实 panel 系统，并已明确选择 `news-row` / `signal-rail` / `market-row` / `commodity-grid` / `calendar-list` / `orderbook-depth` / `status-matrix` / `metric-bars` / `table-monitor` / `funding-pressure-board` / `flash-card` 之一。
- 如果是 funding 类 panel，优先选择 `funding-venue-heatmap`；只有在单一 venue、单一资产压力榜场景下，才退回 `funding-pressure-board`。
- 如果是 funding / positioning / leaderboard 类窄面板，优先选择 `funding-pressure-board` 或 row + nested metrics，不允许用会横向溢出的宽表格。
- funding 的正负含义、venue spread、reset 节奏已经在 UI 中表达出来，而不是只显示一个 funding 数字。
- funding panel 的自动刷新已经打通，前端 interval 和后端 TTL 匹配，不需要依赖手动刷新。
- 没有把 JIN10 厚卡片当成所有 panel 的默认模板。
- 宽高、header、body、card 间距稳定。
- panel body 使用内部滚动和 dark thin scrollbar，内容不会撑高页面。
- 后端 route 已注册到 runtime panel registry。
- 数据源配置来自 `.env`，无明文 secret。
- 能缓存，能 stale fallback。
- API payload 结构稳定，前端字段缺失不崩。
- 本机 pytest 和前端 build 通过。
- 本机代码已推送到 GitHub。
- GCP `/opt/polyData` 已拉取对应 commit。
- GCP 已重启 `polydata-api.service`，并在需要时同步 `/var/www/polydata` 与 reload Nginx。
- 远端 GCP `/wm-api/{runtime_route}` 可访问。
- 最终回答不泄露任何密钥或远端控制敏感信息。
