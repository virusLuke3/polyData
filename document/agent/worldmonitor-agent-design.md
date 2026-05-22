# WorldMonitor Agent 服务设计对照

本文档记录 `worldmonitor` 项目的 Agent 设计，并说明 `polymonitor` 应采用的安全边界，避免再次出现浏览器无限轮询导致 token 被大量消耗的问题。

## 1. UI 设计

截图中的模块是 `AI洞察` 面板，核心结构来自 `worldmonitor/src/components/InsightsPanel.ts`：

- 面板标题：`AI洞察`，右侧有帮助提示、实时状态徽标和设置入口。
- 顶部卡片：`🌎 世界简报`，展示一段已经生成好的摘要，例如 “A US navy chief stated ...”。
- 下方分区：`🎯 焦点`，展示焦点事件、风险等级、证据和关联信号。
- 面板以“当前已有数据的洞察展示”为主，不把“等待 Agent 生成”设计成浏览器持续轮询。

`InsightsPanel.updateInsights()` 的流程是：

1. 先读取服务端预计算的 `serverInsights`。
2. 如果有服务端结果，立即用缓存/预计算结果渲染。
3. 如果没有服务端结果，再走本地客户端分析 fallback。
4. 只有用户修改 AI provider / framework 设置时，才主动重新运行一次更新。

关键点：UI 更新是由数据加载流程触发的单次更新，不是 `warming -> setTimeout -> 再请求 -> 再 warming` 的循环。

## 2. API 边界

`worldmonitor/api/widget-agent.ts` 是浏览器到 Agent 的唯一公开代理层：

- `GET /api/widget-agent`：代理到 relay 的 `/widget-agent/health`，只做健康检查。
- `POST /api/widget-agent`：代理到 relay 的 `/widget-agent`，返回 SSE 流。
- 浏览器只提交用户请求和用户身份，不拿真实 LLM key。
- Edge 函数在服务端验证 Clerk JWT、测试 key 或 legacy key，然后注入真正的 `WIDGET_AGENT_KEY` / `PRO_WIDGET_KEY`。
- relay key 只存在服务端环境变量中，不暴露给浏览器。

`worldmonitor/src/utils/proxy.ts` 根据运行环境选择不同入口：

- dev：`/widget-agent`
- desktop：直接访问 relay，因为桌面 sidecar 会破坏 SSE streaming
- prod web：`/api/widget-agent`，由 Vercel Edge 做鉴权和 key 注入

这个设计把“公开网页入口”和“付费 LLM key”隔开了。

## 3. 防烧 token 设计原则

对 `polymonitor` 来说，需要采用下面的约束：

- 前端不能因为 `warming` 状态自动重试 Agent。
- 同一个 payload 在短时间内只能发起一次 Agent 请求，重复渲染应复用 in-flight promise 或缓存结果。
- 后端不能在 cache miss 时先返回 fallback，再后台启动 LLM 线程，然后诱导前端继续轮询。
- 后端必须做 singleflight：同一个 cache key 正在生成时，后续请求只能拿 fallback，不能再启动新的 LLM 调用。
- `/agent/*` 默认只允许 loopback 访问。公网 `/wm-api/agent/*` 必须 403，除非以后明确改成类似 `worldmonitor` 的服务端鉴权代理。
- Agent 接口必须有每分钟调用上限，防止本机脚本或页面 bug 短时间内打爆代理。

## 4. Polymonitor 当前采用的落地方案

本次修改按以下方式对齐 `worldmonitor` 的安全思路：

- `webpage/src/panels/shared/ai-market-wide.tsx`：删除 `warming` 自动重试定时器。
- `webpage/src/services/api.ts`：为 `/agent/*` 请求增加 5 分钟内存缓存和 in-flight 去重。
- `scripts/api/routes/agent.py`：删除后台 warming refresh，改为同步 singleflight。
- `scripts/api/routes/agent.py`：增加 `POLYDATA_AGENT_LOCAL_ONLY=true` 默认本机访问限制。
- `scripts/api/routes/agent.py`：增加 `POLYDATA_AGENT_RATE_LIMIT_PER_MINUTE`，默认每分钟 6 次。
- `agent/gateway/app.py`：同样增加本机访问限制，防止 gateway 被绑定到公网后直接烧 token。
- `deploy/nginx/polydata-static.conf.example`：保持 `/wm-api/agent/*` 公网 403。

## 5. 推荐运行方式

公网服务可以继续提供普通页面和非 Agent API：

```bash
sudo systemctl restart nginx
systemctl --user restart polydata-api.service
```

Agent 只在本机调用：

```bash
curl -sS http://127.0.0.1:5000/agent/market-wide-insights \
  -H 'Content-Type: application/json' \
  --data '{"lens":"overview","markets":[],"marketGroups":[]}'
```

公网必须保持禁止：

```bash
curl -i https://www.polymonitor.club/wm-api/agent/market-wide-insights
# 期望：HTTP 403
```

如果以后确实要让公网用户使用 Agent，需要重新做一个 `worldmonitor` 风格的服务端代理：用户身份鉴权、套餐/配额判断、服务端注入 key、严格 rate limit、审计日志。不能让浏览器直接访问当前 `/wm-api/agent/*`。
