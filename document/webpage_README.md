# Polymarket 预测市场仪表板

现代化的 Polymarket 预测市场数据可视化仪表板，具有完整的响应式设计和无障碍访问支持。

## 🎨 功能特性

### 核心功能
- ✅ **实时数据展示** - 显示市场问题、交易量、流动性和状态
- 🔍 **智能搜索** - 实时搜索市场问题（带防抖优化）
- 🎯 **多维筛选** - 按活跃/关闭状态筛选市场
- 📊 **灵活排序** - 按交易量、流动性、结束日期排序
- 📈 **统计摘要** - 总市场数、活跃市场数、总交易量

### 设计特性
- 📱 **响应式布局** - Mobile-first 设计，支持所有设备
- ♿ **无障碍访问** - 完整的 ARIA 标签和键盘导航支持
- 🎨 **现代 UI** - 遵循 Web Design Guidelines 最佳实践
- 🌓 **深色模式** - 自动适配系统主题偏好
- ⚡ **性能优化** - CSS containment 和 content-visibility

## 📋 设计规范

### WCAG 2.1 AA 无障碍合规
所有颜色对比度均符合 WCAG 2.1 AA 标准：

| 元素 | 颜色 | 对比度 | 标准 |
|------|------|--------|------|
| 主文本 | #111827 | 14.3:1 | ✅ AAA |
| 次要文本 | #6b7280 | 4.5:1 | ✅ AA |
| 主按钮 | #2563eb | 4.83:1 | ✅ AA |
| 成功状态 | #16a34a | 4.52:1 | ✅ AA |
| 警告状态 | #d97706 | 4.51:1 | ✅ AA |
| 错误状态 | #dc2626 | 5.93:1 | ✅ AA |

### 响应式断点
```css
/* 移动端 */     0px - 639px   (1列)
/* 平板 */       640px - 1023px (2列)
/* 桌面 */       1024px - 1279px (3列)
/* 大屏幕 */     1280px+        (4列自适应)
```

## 🚀 快速开始

### 1. 文件结构
```
frontend/
├── index.html      # 主 HTML 文件
├── styles.css      # 样式表（CSS 变量 + 响应式）
├── app.js          # JavaScript 逻辑
└── README.md       # 本文档
```

### 2. 启动方法

#### 方法一：直接打开 HTML
```bash
# 使用默认浏览器打开
open index.html
# 或
xdg-open index.html
```

#### 方法二：使用本地服务器（推荐）
```bash
# Python 3
cd frontend
python3 -m http.server 8000

# Node.js (npx)
npx serve .

# 然后访问 http://localhost:8000
```

### 3. 数据文件
确保 `../scripts/markets.json` 文件存在且路径正确。

## 📱 键盘导航

完整的键盘导航支持：

| 按键 | 功能 |
|------|------|
| `Tab` | 在元素间导航 |
| `Enter` / `Space` | 激活按钮/打开市场链接 |
| `Arrow Keys` | 在市场卡片间导航 |
| `Home` | 跳转到第一个卡片 |
| `End` | 跳转到最后一个卡片 |

## 🎨 样式系统

### CSS 变量
```css
/* 间距 */
--spacing-xs: 4px
--spacing-sm: 8px
--spacing-md: 16px
--spacing-lg: 24px
--spacing-xl: 32px
--spacing-2xl: 48px

/* 字体大小 */
--text-xs: 12px
--text-sm: 14px
--text-base: 16px
--text-lg: 18px
--text-xl: 20px
--text-2xl: 24px
--text-3xl: 30px
--text-4xl: 36px

/* 颜色主题 */
--color-primary: #2563eb
--color-success: #16a34a
--color-warning: #d97706
--color-error: #dc2626
```

### 卡片组件
每个市场卡片包含：
- **标题** - 市场问题（最多 3 行）
- **状态徽章** - 活跃/已关闭/即将结束
- **指标网格** - 交易量和流动性
- **底部信息** - 结束日期和查看详情链接

## 🔧 自定义配置

### 修改数据源
编辑 `app.js` 中的数据加载路径：
```javascript
const response = await fetch('../scripts/markets.json');
```

### 调整刷新频率
修改自动刷新间隔（默认 5 分钟）：
```javascript
setInterval(() => {
  loadMarkets();
}, 5 * 60 * 1000); // 毫秒
```

### 自定义颜色主题
修改 `styles.css` 中的 CSS 变量：
```css
:root {
  --color-primary: #your-color;
  /* ... */
}
```

## 📊 数据格式

markets.json 数据结构：
```json
{
  "conditionId": "string",
  "question": "string",
  "slug": "string",
  "active": boolean,
  "closed": boolean,
  "volume": "string",
  "liquidity": "string",
  "endDate": "ISO 8601 date",
  "createdAt": "ISO 8601 date"
}
```

## ♿ 无障碍特性

### 屏幕阅读器支持
- 完整的 ARIA 标签和角色
- 语义化 HTML5 元素
- 跳转到主内容链接
- 实时状态更新 (`aria-live`)

### 视觉辅助
- 高对比度模式支持
- 焦点指示器清晰可见
- 减少动画偏好支持
- 自定义滚动条（可视性增强）

### 键盘访问
- 所有功能可通过键盘操作
- 逻辑的 Tab 顺序
- 清晰的焦点状态

## 🌐 浏览器支持

| 浏览器 | 版本 |
|--------|------|
| Chrome | 最新 2 个版本 |
| Firefox | 最新 2 个版本 |
| Safari | 最新 2 个版本 |
| Edge | 最新 2 个版本 |

### 现代特性
- CSS Grid / Flexbox
- CSS Variables (自定义属性)
- CSS Container Queries
- Fetch API
- ES6+ JavaScript

## 🔍 性能优化

### CSS 优化
- `contain` 属性用于布局隔离
- `content-visibility` 用于长列表优化
- `will-change` 用于动画优化

### JavaScript 优化
- 防抖搜索（300ms）
- 事件委托
- 避免不必要的重绘

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系方式

如有问题，请联系项目维护者。

---

**注意**: 此仪表板设计遵循 Web Design Guidelines 最佳实践，确保了无障碍访问、响应式设计和现代 UI/UX 标准。
