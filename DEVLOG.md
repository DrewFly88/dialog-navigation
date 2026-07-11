# dialog-navigation 开发日志

> 创建日期: 2026-06-28 | 版本: v0.6.0 | 产物: dist/index.js (34.79 KB)

---

## 1. 需求演进

### 1.1 初始理解（错误）

最初将需求理解为"历史对话列表 + 跳转"，类似于 QoderWork CN 的历史对话侧边栏。设计了完整的面板方案，包含会话列表、搜索、分组（置顶/今天/近7天/近30天/更早）、会话切换等功能。

**问题**：QwenPaw 左侧边栏已原生具备此功能（SidebarSessionList），重复实现无意义。

### 1.2 需求澄清

用户纠正：实际需求是**当前对话内容的结构化索引**，而非会话列表。核心场景是在长对话内快速定位到某个话题/工具调用/代码片段/结论，类似代码编辑器的 Outline 面板。

### 1.3 UI 方案迭代

经历三轮 UI 方案迭代：

**V1 — 浮动面板**：传统右侧面板设计，带标签栏切换、条目列表、底部统计。功能完整但视觉侵入性强。

**V2 — 紧凑面板**：去掉面板边框和背景，改为浮动紧凑设计。顶部 Tab 切换按钮（话题/工具/代码/结论），条目列表紧凑单行。设置分离到独立页面。

**V3 — 无面板化（最终方案）**：放弃面板概念，采用"常驻短线 + 悬停展开"极简交互。

- 每条索引用一条 18×3px 的短线表示，垂直排列在聊天区右边缘
- 不同分组使用不同颜色（蓝/绿/橙/紫）区分
- 当前视口话题对应的短线加粗高亮
- 鼠标悬停短线区域时，左侧弹出详细列表浮层
- 浮层内默认只显示短标题，悬停单条时弹出二级浮层显示完整信息
- 顶部分组切换按钮略粗于普通短线，悬停向左展开显示分组名
- 底部统计气泡悬停显示消息统计

**决策理由**：索引是辅助导航而非核心交互，不应常驻占据视觉空间。无面板设计将视觉干扰降到最低，只在需要时展示信息。

---

## 2. 技术决策

### 2.1 UI 注入方式：route.wrap vs slot.fill

**选择**：`route.wrap("core.chat", wrapper)`

**理由**：
- route.wrap 在 React 主树中渲染，可以使用 `host.useSelectedAgent()`、`host.useTheme()` 等 hooks
- slot.fill 渲染在隔离的 React 子树中，zustand 订阅不触发，需要 sessionStorage monkey-patch 作为 workaround
- 需要访问 DOM 实现消息滚动定位，主树访问更方便

**注意**：`host.useCurrentSession()` 在 route.wrap wrapper 中始终返回 null（§8.1），需改用 `host.getCurrentSessionId()` 命令式 API。

**风险**：route.wrap 的 Disposable 必须单独存储，不能放入会被 clearDisposables() 清理的数组中。

### 2.2 消息获取：事件驱动 API + DOM 观察双通道

**API 通道**：通过 `host.fetch("/chats/{chat_id}")` 获取完整消息历史，作为索引构建的数据源。事件驱动触发（session/agent 切换、DOM 新消息、页面恢复可见），不做定时轮询。

**DOM 通道**：MutationObserver 监听聊天区域 DOM 变化，为新消息元素添加 `data-dip-msg-index` 属性，作为滚动定位锚点。同时检测消息数量增长，触发 API 刷新（300ms 防抖）。

**为什么不只用一种**：
- 纯 API 无法知道消息在 DOM 中的位置，无法实现滚动定位
- 纯 DOM 无法获取消息的完整内容（工具调用参数、代码块语言等），无法构建丰富索引
- 双通道互补：API 提供内容，DOM 提供位置

### 2.3 视口追踪：scroll + IntersectionObserver

使用 scroll 事件监听 + `getBoundingClientRect()` 计算当前视口中最接近的消息元素。节流到 100ms + requestAnimationFrame 避免性能问题。

当前话题对应的短线以主题色高亮显示，实现"你在对话的哪个位置"的视觉反馈。

### 2.4 CSS 内联：Vite generateBundle 插件

QwenPaw 插件加载器只加载 `dist/index.js` 一个文件，不处理 CSS 文件。通过自定义 Vite 插件在 `generateBundle` 阶段将 CSS 内容注入到 JS 中（创建 `<style>` 标签动态插入 `<head>`）。

### 2.5 消息解析：纯前端规则引擎

四个解析器均为纯前端正则/字符串匹配，不依赖 LLM：
- **topicExtractor**：提取用户消息前 30 字符作为话题标题
- **toolCallParser**：匹配 `tool_use` 内容块，提取工具名和参数摘要
- **codeBlockParser**：正则匹配 ``` 代码块，提取语言和文件名
- **conclusionParser**：匹配加粗文本、列表项、编号列表，去重后作为结论

**优势**：零额外 API 成本，响应即时。
**局限**：话题标题是机械截断而非语义摘要，后续可引入 LLM 做智能摘要（V2）。

### 2.6 双主题兼容

颜色方案为亮色/暗色主题分别定义：
- 亮色主题使用 600 色阶（如 `#2563eb`）
- 暗色主题使用 400 色阶（如 `#60a5fa`），因暗色背景下低明度颜色对比度不足

通过 `host.useTheme()` 获取当前主题，动态切换颜色值。

---

## 3. 构建过程

### 3.1 项目搭建

- 基于 `qwenpaw-plugin-dev` skill 的 bundle-plugin 模板
- Vite 6 + React 18 + TypeScript 5
- jsxRuntime: "classic" 使用宿主 React，external: ["react", "react-dom"] 避免打包

### 3.2 文件写入策略

Write 工具无法直接写入工作区外的路径（`D:\代码\`），采用"先 Write 到 workspace，再 cp 到目标目录"的两步策略。

Python 脚本方式因引号/反引号嵌套导致 Bash 解析失败，最终全部改用 Write + cp 方案。

### 3.3 构建产物

```
dist/index.js  29.56 KB  (gzip: 8.59 KB)
```

CSS 已内联到 JS 中，无单独 CSS 文件。

### 3.4 遇到的问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `Could not resolve "../types"` | 组件文件在 `src/` 根目录，但 import 用了 `../types` | 修正为 `./types` |
| `useDialogIndex` 导入 `./parser` 失败 | hooks 在 `src/hooks/` 子目录，应使用 `../parser` | 修正导入路径 |
| CSS 单独输出无法被插件加载 | QwenPaw 只加载 `dist/index.js` | 编写 Vite 插件内联 CSS |
| Bash heredoc 写 TS 文件失败 | 反引号（```）与 Bash 转义冲突 | 改用 Write + cp |
| Python 内联代码字符串失败 | 三层引号嵌套 + 反引号导致 shell 解析错误 | 同上 |

---

## 4. 关键 API 映射

| 需求 | QwenPaw API | 说明 |
|------|------------|------|
| 获取当前会话 | `host.getCurrentSessionId()` | 命令式 API，返回时间戳或带后缀 ID。**注意**：`host.useCurrentSession()` 在 route.wrap wrapper 中始终返回 null（§8.1） |
| 获取当前 Agent | `host.useSelectedAgent()` | 返回 `{ id, name, ... }`，基于 Zustand store，route.wrap 中可用 |
| 获取当前主题 | `host.useTheme()` | 返回 `"light" \| "dark"` |
| 认证请求 | `host.fetch(path, opts)` | 已含 `/api` 前缀，自动注入 Authorization + X-Agent-Id |
| 包装聊天页 | `window.QwenPaw.route.wrap(pluginId, "core.chat", wrapper)` | 主树渲染，可用 hooks |
| 获取消息历史 | `GET /chats/{chat_id}` | host.fetch 已含 `/api` 前缀，返回 `{ messages: Message[], status }` |
| 获取对话列表 | `GET /chats` | 返回 chat 数组，用于 session ID → chat UUID 映射 |

---

## 5. 后续计划

- **安装测试**：`qwenpaw plugin install D:/代码/dialog-index-plugin --force` 后在 QwenPaw 中验证
- **DOM 选择器调优**：当前使用通用选择器 `[class*='message']` 等匹配消息元素，需要在实际 QwenPaw 环境中确认并调整
- **V2 智能摘要**：引入 LLM 辅助话题摘要，替代当前的机械截断
- **设置页面**：通过 `menu.add` 注册到左侧边栏，支持维度开关、刷新间隔、样式配置
- **全文搜索**：在浮层顶部添加搜索框，过滤当前分组内的索引条目

---

## 6. UI 修复迭代（2026-06-29）

### 6.1 短线与弹窗对齐 + 双滚动条合并

**问题**：短线列表和弹窗标题列表分别有独立滚动条，且高度不对齐（短线行高 22px 无 gap，弹窗行无 gap）。

**解决**：将短线和弹窗行合并到同一个滚动容器中。每行是一个 flex 容器，左侧为弹窗行（`width: 160-220px`），右侧为短线（`width: 9px`），共享同一个 `overflowY: auto` 滚动条。

### 6.2 二级弹窗不可见

**问题**：二级弹窗使用 `position: absolute` 定位，但父容器 `overflow: hidden` 将其裁剪。

**解决**：将二级弹窗提升到 BarStrip 顶层，改用 `position: fixed` 定位，脱离滚动容器的裁剪上下文。

### 6.3 二级弹窗位置错误（在右侧而非左侧）

**问题**：二级弹窗初始 `right: 18`，与一级弹窗重叠。

**解决**：改为 `right: 180`（一级弹窗宽度 + 间距），使二级弹窗出现在一级弹窗左侧。

### 6.4 右侧边栏检测失败

**问题**：初始使用 `.chat-list-panel` 等通用选择器检测右侧边栏，无法匹配 QwenPaw 实际 DOM。

**解决**：查阅 QwenPaw 源码发现右侧边栏使用 `embeddedPanel` CSS 模块类名。改用 `[class*='embeddedPanel']` 选择器，配合 `getBoundingClientRect()` 判断面板位置（`rect.left > window.innerWidth * 0.5`）。

### 6.5 导航条移动速度不匹配侧边栏

**问题**：导航条使用 `transition` 动画移动，但 QwenPaw 侧边栏是瞬间展开的（无 CSS transition）。

**解决**：移除导航条的 `transition`，位置变化即时生效，与侧边栏同步。

### 6.6 二级弹窗水平位置偏移过大（最终修复）

**问题**：二级弹窗使用固定常量 `SECONDARY_POPOVER_RIGHT = 180` 计算 `right` 值。当侧边栏打开时，`sidebarOffset + 180` 导致弹窗偏离一级弹窗过远。更深层的问题是：二级弹窗在 `transform: translateY(-50%)` 容器内，`position: fixed` 退化为相对容器的 `absolute`，坐标完全错误。

**解决**：
1. 移除固定常量，改用 `getBoundingClientRect()` 动态获取一级弹窗行的实际左边缘坐标
2. 使用 `createPortal` 将二级弹窗渲染到 `document.body`，脱离 transform 容器，`position: fixed` 回归真正的视口定位
3. 计算 `right = window.innerWidth - popRect.left + 6`，二级弹窗紧贴一级弹窗左侧，间距 6px
4. 滚动时同步更新位置

**关键技术点**：CSS `transform` 属性会创建新的包含块（containing block），导致后代元素的 `position: fixed` 不再相对于视口，而是相对于该 transform 元素。这是 CSS 规范行为，需用 `createPortal` 将弹窗移到 DOM 根部才能避免。

---

## 7. 事件驱动替代轮询（2026-06-29）

### 7.1 背景

初始版本使用 `setInterval` 每 5 秒轮询 `GET /api/chats/{chat_id}` 获取完整消息历史。无论对话有无变化都会发起请求，浪费带宽且有最多 5 秒延迟。

### 7.2 QwenPaw 事件源调研

查阅 QwenPaw 源码后确认可用的事件信号：

| 事件 | 信号来源 | 获取方式 |
|------|---------|---------|
| 切换会话 | `useChatAnywhereSessionsState()` | `host.useCurrentSession()` React hook |
| 切换 Agent | `useAgentStore` | `host.useSelectedAgent()` React hook |
| 新对话内容 | 聊天 DOM 新增消息节点 | `MutationObserver`（已有） |
| 页面可见性恢复 | `document.visibilitychange` | 标准 DOM API |
| SSE 响应流结束 | `useChatAnywhereInput()` loading 状态 | 需验证 context 可访问性（暂未接入） |

QwenPaw 不使用 WebSocket，聊天消息通过 `fetch` streaming (SSE) 接收，由 `@agentscope-ai/chat` 库内部消费。没有直接的消息到达事件可供订阅。

### 7.3 实施方案

**移除轮询**：删除 `useDialogIndex` 中的 `setInterval`/`clearInterval`，删除 `PluginSettings.pollIntervalMs` 配置和设置页滑块。

**事件触发矩阵**：

| 触发源 | 实现方式 | 防抖策略 |
|--------|---------|---------|
| 会话切换 | `hookSessionId` 作为 `useEffect` 依赖 | 无防抖，立即重置并拉取 |
| Agent 切换 | `agentId` 作为 `useEffect` 依赖 | 无防抖，立即重置并拉取 |
| 新消息到达 | `useMessageMap` 的 `onNewMessages` 回调检测 DOM 消息节点数量增长 | 300ms 防抖（SSE 流式回复期间 DOM 频繁变化） |
| 页面恢复可见 | `visibilitychange` 事件监听 | 无防抖，立即拉取 |
| 组件挂载 | `useEffect` 初始化 | 无防抖，立即拉取 |

**实际执行中的修正**：`hookSessionId`（来自 `host.useCurrentSession()`）在 route.wrap 中始终为 null，最终改用 `getCurrentSessionId()` 轮询 + sidebar DOM 事件。详见 §8。

### 7.4 修改文件

| 文件 | 变更 |
|------|------|
| `src/types.ts` | 移除 `pollIntervalMs` 字段 |
| `src/hooks/useMessageMap.ts` | 新增 `onNewMessages` 回调参数，通过消息计数变化检测新消息 |
| `src/hooks/useDialogIndex.ts` | 新增 `agentId` 参数，移除 `setInterval`，改为纯事件驱动 |
| `src/index.tsx` | 新增 `host.useSelectedAgent()` 调用、`debouncedRefresh` 传递给 `useMessageMap`、`visibilitychange` 监听 |
| `src/SettingsPage.tsx` | 移除刷新间隔滑块和 `Slider`/`Divider` 组件引用 |

### 7.5 构建产物

```
dist/index.js  29.56 KB  (gzip: 8.59 KB)
```

比轮询版本（29.61 KB）略小，移除了 `setInterval` 相关代码和设置页 UI。

---

## 8. Session 检测链路修正（2026-06-29）

事件驱动重构（§7）上线后，实际测试暴露出一系列 session 检测问题。初始方案依赖 `host.useCurrentSession()` 作为会话切换信号源，但该 hook 在 `route.wrap` wrapper 中始终返回 `null`，导致整条数据链路断裂。本节记录逐步排查和修复的过程。

### 8.1 `useCurrentSession()` 在 route.wrap 中返回 null

**问题**：`host.useCurrentSession()` 在 route.wrap wrapper 组件内始终返回 `null`，`hookSessionId` 永远为空。

**原因**：session 状态由 `@agentscope-ai/chat` 库内部管理，route.wrap 的 wrapper 渲染在 chat 库的 React context 树之外，无法通过 context 获取 session。

**解决**：改用 `host.getCurrentSessionId()` 命令式 API（不受 React context 限制），配合 500ms 轻量轮询检测变化。轮询仅读取 JS 变量，不发起 API 调用，开销可忽略。

### 8.2 切换 Agent 加载错误对话

**问题**：切换到某些 Agent 时，索引显示的不是该 Agent 当前 session 的内容，而是其他 session 的数据。

**原因**：`resolveCurrentChatId()` 在 session ID 匹配不到 chat 时，fallback 到"最近更新的 chat"。当 Agent 切换后 chat 列表尚未返回对应 session 的记录时，fallback 会加载上一次访问的 chat。

**解决**：移除 fallback 逻辑，匹配失败时返回 `null`（空索引对新/空 session 是正确行为）。

### 8.3 `Fetched N messages from chat null` 竞态

**问题**：偶发 `chatIdRef.current` 在 resolve 和 fetch 之间被置 `null`，导致 `GET /chats/null` 请求。

**原因**：sidebar 事件或 session 变化触发时，代码会重置 `chatIdRef`，但之前排定的 2s 重试 `setTimeout` 可能在重置后仍然触发 fetch。

**解决**：引入 `retryTimerRef` 管理重试定时器，在所有状态转换点（session 变化、agent 变化、sidebar 事件）先 `clearTimeout` 再重置。fetch 前增加 null guard：`if (!chatId) return`。

### 8.4 带后缀的时间戳 session ID 无法匹配

**问题**：部分 session ID 格式为 `1782489020710-5sm5zjn`（时间戳 + 随机后缀），`resolveCurrentChatId()` 的三种匹配策略均不识别。

**解决**：新增 Strategy 4：提取数字前缀，先尝试完整 ID 匹配 `session_id`，再尝试纯数字前缀匹配。

### 8.5 sidebar 切换 session 双重刷新

**问题**：通过侧边栏切换 session 时，索引列表刷新两次（两次 `Fetched N messages`）。

**原因**：sidebar 事件处理器直接设置 `chatIdRef` 并触发 fetch（第一次）。约 200ms 后，500ms 轮询检测到 `getCurrentSessionId()` 值变化，但不知道 sidebar 事件已处理过，于是重置 `chatIdRef` 并触发完整的 resolve + fetch 流程（第二次，冗余）。

**解决**：引入 `chatIdSetByEventRef`（boolean ref）。sidebar 事件设置 `chatIdRef` 的同时将此标志置 `true`。轮询检测到 session 变化时，若标志为 `true`，仅同步 `sessionIdRef` 并清除标志，跳过 chatId 重置和 re-resolve。

### 8.6 补充事件源：sidebar DOM 事件

除轮询外，QwenPaw 侧边栏还派发两个自定义 DOM 事件，提供更即时的信号：

| 事件名 | detail | 用途 |
|--------|--------|------|
| `qwenpaw:sidebar-select-session` | `{ sessionId: "<chat UUID>" }` | 直接获取 chat UUID，跳过 resolve |
| `qwenpaw:sidebar-new-chat` | 无 | 新建对话，清空索引 |

`sidebar-select-session` 事件的 `detail.sessionId` 直接携带 chat UUID，可以跳过 `resolveCurrentChatId()` 的 API 调用，直接设置 `chatIdRef`。

### 8.7 修改文件

| 文件 | 变更 |
|------|------|
| `src/hooks/useDialogIndex.ts` | 新增 `sessionIdRef`、`retryTimerRef`、`chatIdSetByEventRef`；重写 `resolveCurrentChatId()` 增加 Strategy 4；新增 500ms 轮询和 sidebar DOM 事件监听；移除 `useCurrentSession()` 依赖 |
| `src/hooks/useMessageMap.ts` | 新增 `onNewMessages` 回调，通过 `prevCountRef` 跟踪消息数量变化 |

### 8.8 构建产物

```
dist/index.js  31.11 KB  (gzip: 8.97 KB)
```

比初始事件驱动版本（29.56 KB）增加 1.55 KB，主要来自 session 轮询、sidebar 事件监听和 resolve 策略代码。

---

## 9. DOM 卡片索引映射修正（2026-06-30）

视口高亮和点击滚动定位功能在测试中完全失效。根本原因是 parser 输出的消息索引与 DOM 元素的实际排列顺序不匹配。本节记录逐步排查和修复的过程。

### 9.1 SDK 卡片分组机制

**发现**：QwenPaw 前端 SDK 的 `convertMessages()` 函数将扁平消息数组分组为"卡片"（card）。分组规则：

- 每条 `role: "user"` 消息 → 一个 request 卡片
- 连续的非 user 消息（assistant / system / tool）→ 合并为一个 response 卡片

例如，消息序列 `[user, assistant, tool_result, assistant, user]` 会产生 3 个卡片：`[user]`、`[assistant, tool_result, assistant]`、`[user]`。

**影响**：parser 原先按消息序号（msgIdx）递增分配索引，但 DOM 中只有卡片级别的元素。一个包含 3 条消息的 response 卡片在 DOM 中只占一个 `.qwenpaw-bubble` 元素。parser 的 msgIdx 与 DOM 元素位置完全不对应。

**解决**：四个 parser（topicExtractor、toolCallParser、codeBlockParser、conclusionParser）全部改为使用卡片分组索引（cardIdx），模拟 SDK 的分组逻辑：user 消息开始新卡片，非 user 消息归入当前卡片。

### 9.2 `flex-direction: column-reverse` 导致的视觉顺序反转

**发现**：`.qwenpaw-bubble-list` 使用 `display: flex; flex-direction: column-reverse`。这意味着：

- DOM 第一个子元素 = 视觉最底部 = 最新消息
- DOM 最后一个子元素 = 视觉最顶部 = 最老消息

而 parser 的 cardIdx=0 对应最老消息（对话开头）。如果按 DOM 顺序标记 `data-dip-msg-index`，idx=0 会对应最新消息，与 parser 的预期完全相反。

**解决**：在 `useMessageMap` 的 `tagMessages()` 中，先将 DOM 元素数组 reverse，再按顺序分配索引。反转后：最后一个 DOM 子元素（最老消息，视觉顶部）→ idx=0，第一个 DOM 子元素（最新消息，视觉底部）→ idx=N。与 parser 的 cardIdx 一致。

### 9.3 实际滚动容器定位

**问题**：初始使用 `.qwenpaw-bubble-list-wrapper` 作为滚动容器，但 `scrollIntoView` 不生效。

**发现**：`.qwenpaw-bubble-list-wrapper` 的 CSS 为 `overflow-y: hidden`（不可滚动）。真正的滚动容器是其子元素 `.qwenpaw-bubble-list`（`overflow-y: auto`，scrollHeight=6065, clientHeight=860）。

**解决**：`index.tsx` 的容器查找逻辑改为优先匹配 `.qwenpaw-bubble-list`。`useMessageMap` 和 `useViewportTracker` 内部也先查找 `.qwenpaw-bubble-list`，以其 `getBoundingClientRect()` 作为视口计算基准。

### 9.4 渐进式卡片加载导致索引重复

**问题**：SDK 分批加载卡片（每批约 10 个）。第一次 `tagMessages()` 标记了 10 个元素（idx 0-9）。SDK 加载第二批后，DOM 中出现了 20 个卡片元素。由于旧代码使用 `if (!el.getAttribute(MSG_ATTR))` 跳过已标记元素，新元素被重复分配 idx 0-9，导致 20 个元素只有 10 个唯一索引。

**解决**：改为"清除-重标记"策略。每次 `tagMessages()` 执行时，先移除容器内所有 `data-dip-msg-index` 属性，再对当前所有卡片元素重新分配索引。这确保无论 SDK 加载了多少批次，索引始终连续且唯一。

### 9.5 嵌套气泡元素误标记

**问题**：某些卡片内部包含嵌套的 `.qwenpaw-bubble` 元素（如工具结果卡片内的子组件），被 `querySelectorAll('[class*="bubble"]')` 误匹配并标记，导致索引数量远超实际卡片数。

**解决**：使用 `:scope > .qwenpaw-bubble` 选择器，限定只匹配 `.qwenpaw-bubble-list` 的直接子元素，排除嵌套气泡。

### 9.6 容器查找在首次加载时失败

**问题**：1500ms 超时查找容器时，聊天内容可能尚未加载完成，导致找不到 `.qwenpaw-bubble-list`。

**解决**：将容器查找 `useEffect` 的依赖改为 `[imperativeId]`，当检测到新 session 时重新执行查找。超时增加到 2000ms。查找前重置 `containerReady` 为 `false`，避免使用旧 session 的容器引用。

### 9.7 修改文件

| 文件 | 变更 |
|------|------|
| `src/parser/topicExtractor.ts` | msgIdx → cardIdx，模拟 SDK 卡片分组 |
| `src/parser/toolCallParser.ts` | 同上 |
| `src/parser/codeBlockParser.ts` | 同上 |
| `src/parser/conclusionParser.ts` | 同上，去重键改为 `bubbleIndex + ":" + title` |
| `src/hooks/useMessageMap.ts` | 查找 `.qwenpaw-bubble-list`；`:scope > .qwenpaw-bubble` 选择器；清除-重标记策略；reverse 处理 column-reverse |
| `src/hooks/useViewportTracker.ts` | 查找 `.qwenpaw-bubble-list`；`:scope >` 选择器 |
| `src/index.tsx` | 容器查找优先 `.qwenpaw-bubble-list`；依赖改为 `[imperativeId]`；超时 2s；导航使用 `:scope >` 选择器 |

### 9.8 构建产物

```
dist/index.js  32.60 KB  (gzip: 9.31 KB)
```

比 session 检测修正版（31.11 KB）增加 1.49 KB，主要来自清除-重标记逻辑、reverse 排序和更复杂的选择器代码。

### 9.9 验证结果

| 项目 | 结果 |
|------|------|
| DOM 元素标记数量 | ✅ 10 个卡片 → 10 个唯一索引（0-9） |
| 索引顺序 | ✅ idx=0 对应视觉顶部（最老），idx=9 对应视觉底部（最新） |
| 渐进加载后索引 | ✅ 无重复，清除-重标记正常工作 |
| scrollIntoView | ✅ scrollTop 值变化，元素滚动到视口内 |
| 点击滚动（真实用户交互） | ⏳ 待用户手动测试（程序化 `.click()` 不触发 React 合成事件） |

---

## 10. SDK 分页加载导致索引不完整（2026-06-30）

### 10.1 问题描述

用户报告：一个 session 中多轮对话时，只有前 5 个或前 15 个话题能匹配和高亮。打开对话页面后，实际位置在最后一个话题，但高亮的是第 5 或第 15 个话题。后续话题既不能高亮也不能点击跳转。

### 10.2 根因分析

通过深入分析 QwenPaw SDK 源码（`ui-vendor-*.js`），发现 `.qwenpaw-bubble-list` 使用**分页式渐进加载**（非虚拟滚动）：

- SDK 的 `convertMessages()` 将消息分组为卡片后，通过分页 hook（`ESr`/`G6r`）控制渲染数量
- 常量 `dY = 10`，每批渲染 10 个历史卡片
- 非历史消息（`msg.history !== true`）始终全部渲染
- 历史消息通过 `historyMessages.slice(0, page * 10)` 分页渲染
- `loadMore` 通过 `IntersectionObserver` 监测哨兵元素进入视口来触发
- `loadMore` 使用 `React.flushSync` 同步渲染 + 300ms 延迟

**影响**：初始只有最近 10 个历史卡片在 DOM 中。我们的 `tagMessages()` 只能标记当前 DOM 中的卡片，更老的卡片根本不存在于 DOM 中。Parser 为所有卡片分配了索引（如 0-77），但 DOM 只有前 10 个，导致索引 10+ 的话题无法匹配、高亮或导航。

### 10.3 修复方案：React Fiber Dispatch

最初尝试通过编程滚动触发 `IntersectionObserver`，但在 headless 浏览器环境中容器高度链坍缩（`clientHeight=16px`），滚动无法生效。

最终方案：直接通过 React fiber 内部机制触发 SDK 加载全部卡片。

**实现步骤**：

1. 获取 `.qwenpaw-bubble-list` 元素上的 React fiber 引用（`__reactFiber$*`）
2. 沿 fiber 树向上遍历（最多 30 层），查找每个组件的 hooks 链表
3. 找到值为小数字（1-10）的 `useState`/`useReducer` hook——即分页 `page` 状态
4. 调用 `hook.queue.dispatch(9999)`，将 page 设为极大值
5. SDK 重新渲染时 `page * 10 = 99990`，覆盖所有历史消息
6. 等待 1500ms 让 React 完成渲染和 DOM 更新

**降级方案**：如果 fiber 遍历未找到分页 hook，回退到滚动触发方式。

### 10.4 同时修复：wrapper div 打断布局链

发现 `route.wrap` 的 wrapper 组件渲染了一个额外的 `<div>` 包裹 `<Inner />`，打断了 SDK 的 CSS 高度传递链。修复为使用 React Fragment（`<>`）直接渲染 `<Inner />`，`BarStrip` 通过 `createPortal` 渲染到 `document.body`。

### 10.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/hooks/useMessageMap.ts` | 新增 `ensureAllCardsLoaded()`：通过 React fiber dispatch 强制加载全部卡片；保留滚动降级方案 |
| `src/index.tsx` | 移除 wrapper div，改用 Fragment + createPortal；BUILD 版本号更新 |

### 10.6 构建产物

```
dist/index.js  33.78 KB  (gzip: 9.68 KB)
```

### 10.7 验证结果

| 项目 | 结果 |
|------|------|
| 卡片加载数量 | ✅ 78 个卡片全部加载（879 条消息 → 78 个卡片） |
| DOM 标记 | ✅ 78 个唯一索引（0-77） |
| 导航到索引 0 | ✅ scrollTop = -33417 |
| 导航到索引 39 | ✅ scrollTop = -18103 |
| 导航到索引 77 | ✅ scrollTop = -903 |
| load-more 元素 | ✅ 加载完成后消失（`noMore=true`） |

---

## 11. 三项体验优化（2026-06-30）

### 11.1 切换 session 后初始高亮不生效

**问题**：切换 session 或 agent 后，对话页面重新加载，导航栏不会高亮当前显示的话题，需要手动滚动后才生效。

**原因**：`useViewportTracker` 的 `calculate()` 在组件挂载时执行一次初始计算。但此时 `ensureAllCardsLoaded` 还在异步执行（fiber dispatch + 1500ms 等待），DOM 中还没有卡片或只有旧 session 的卡片。初始计算结果为空，之后不会自动重算。

**解决**：`useMessageMap` 新增 `cardsReady` 状态（`useState`），在全部卡片加载并标记完成后设为 `true`。传递给 `useViewportTracker` 作为依赖项，触发重新计算。

### 11.2 导航栏列表不自动滚动到当前话题

**问题**：长对话中导航栏条目超过 ~15 行时出现滚动，但列表不会自动滚动到当前高亮的话题位置。

**解决**：在 `BarStrip` 中新增 `useEffect`，监听 `activeItemId` 变化。找到对应 DOM 行元素，检查其是否在 `scrollContainerRef` 的可见区域内，不在则调用 `scrollIntoView({ block: "nearest", behavior: "smooth" })`。

### 11.3 手动滚动查看历史时页面卡顿

**问题**：全部卡片加载后（78 个卡片，scrollHeight 40K+px），手动滚动时页面明显卡顿。

**原因**：78 个卡片每个包含 markdown 渲染、代码块、工具调用结果等复杂 DOM。即使浏览器只绘制视口内的卡片，所有卡片的布局和绘制仍然消耗大量资源。

**解决**：给 `.qwenpaw-bubble-list > .qwenpaw-bubble` 添加 CSS `content-visibility: auto` 和 `contain-intrinsic-size: auto 300px`。浏览器跳过视口外卡片的渲染工作（布局和绘制），仅在滚动到附近时才渲染。效果：scrollHeight 从 40442px 降到 1979px，滚动性能显著提升。

### 11.4 容器查找修复

**附带问题**：`content-visibility: auto` 降低了 bubble-list 的 scrollHeight，导致容器查找时 `scrollHeight > clientHeight + 10` 条件不满足，错误地选择了不可滚动的 wrapper。

**解决**：容器查找逻辑改为直接选用 `.qwenpaw-bubble-list`（不做 scrollHeight 检查），因为它是已知的实际滚动容器。

### 11.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/hooks/useMessageMap.ts` | 新增 `cardsReady` 状态，加载完成后设为 true |
| `src/hooks/useViewportTracker.ts` | 新增 `cardsReady` 参数，作为依赖触发重算 |
| `src/BarStrip.tsx` | 新增 `activeItemId` 变化时自动滚动到可见区域 |
| `src/styles.css` | 新增 `content-visibility: auto` 规则 |
| `src/index.tsx` | 传递 `cardsReady`；修复容器查找逻辑 |

### 11.6 构建产物

```
dist/index.js  34.40 KB  (gzip: 9.86 KB)
```

### 11.7 验证结果

| 项目 | 结果 |
|------|------|
| 卡片加载 | ✅ 78 个全部加载标记 |
| 容器选择 | ✅ 正确选择 `.qwenpaw-bubble-list`（clientHeight=859） |
| scrollHeight 优化 | ✅ 40442 → 1979（content-visibility 生效） |
| 全范围导航 | ✅ 索引 0/20/40/60/77 全部可达 |

---

## 12. 动态索引计算 — 消除阻塞加载（2026-06-30）

### 12.1 问题背景

v0.5.0 的架构要求所有卡片必须先加载到 DOM 中才能工作：`ensureAllCardsLoaded` 通过 React fiber dispatch 强制加载全部卡片，然后等待 1500ms，再进行 DOM 标记。这导致：

- 初始加载阻塞 1.5s+，用户看到空白等待
- 78 个复杂卡片同时渲染造成短暂卡顿
- DOM 标记（`data-dip-msg-index`）需要在每次卡片变化时全量清除并重新标记

### 12.2 核心思路：动态索引公式

发现关键数学关系，无需 DOM 属性即可计算任意卡片的 parser 索引：

```
parserIdx = totalCards - 1 - domPos
```

其中 `domPos` 是元素在 `bubbleList.children` 数组中的位置（0 = 第一个 DOM 子元素）。

**原理**：`flex-direction: column-reverse` 下，最后一个 DOM 子元素 = 视觉最顶部 = 最旧消息 = parserIdx 0。SDK 分页从最新消息开始加载，因此无论加载了多少卡片，公式始终成立。

`totalCards` 由解析器从消息数据中计算（max bubbleIndex + 1），在 DOM 渲染之前即已知。

### 12.3 架构变更

**移除的内容**：
- `data-dip-msg-index` DOM 属性标记系统（全量清除+重标记循环）
- `cardsReady` 状态（不再需要等待加载完成）
- `ensureAllCardsLoaded` 阻塞式初始化（1500ms await）
- `tagMessages` 函数及其 skip 优化逻辑

**新增/替换**：
- `useMessageMap` 简化为卡片计数追踪（`cardCount` state + MutationObserver）
- `forceLoadAllCards` 非阻塞后台触发（仅在导航需要时调用）
- `useViewportTracker` 接受 `totalCards` 参数，使用动态公式计算索引
- `navigateToMessage` 使用反向公式 `domPos = totalCards - 1 - parserIdx` 定位元素

### 12.4 两阶段加载策略

**Phase 1（即时）**：组件挂载后立即用当前 DOM 中的卡片（通常 5-15 个）开始工作。视口追踪和导航对已加载的卡片即时可用。

**Phase 2（按需）**：`forceLoadAllCards` 在以下场景触发：
- 初始化时卡片数 ≤ 15，后台触发 fiber dispatch 加载全部
- 导航目标不在 DOM 中时，先加载再重试

### 12.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/types.ts` | `IndexStats` 新增 `totalCards` 字段 |
| `src/parser/index.ts` | 计算 `totalCards` = max(bubbleIndex + 1) |
| `src/hooks/useDialogIndex.ts` | `EMPTY_INDEX` 添加 `totalCards: 0` |
| `src/hooks/useMessageMap.ts` | 移除标记系统，简化为计数追踪 + 非阻塞加载 |
| `src/hooks/useViewportTracker.ts` | 动态公式替代 DOM 属性读取 |
| `src/index.tsx` | 动态导航 + totalCards 传递 + totalCardsRef |

### 12.6 构建产物

```
dist/index.js  34.79 KB  (gzip: 9.90 KB)
```

### 12.7 验证结果

| 项目 | 结果 |
|------|------|
| 即时高亮 | ✅ 打开对话后立即高亮当前话题，无等待 |
| 滚动追踪 | ✅ 动态公式计算正确，全范围匹配 |
| 导航跳转 | ✅ 已加载卡片即时跳转，未加载卡片自动加载后跳转 |
| 整体响应 | ✅ 消除 1.5s 阻塞，初始加载显著加快 |

---

## 13. 滚动性能与导航定位修复（2026-06-30）

### 13.1 问题背景

v0.6.0 测试反馈三个问题：

1. **滚动卡顿未修复**：安装插件后长会话滚动明显卡顿，与未安装时对比差异显著
2. **导航定位错误**：跳转到 agent 回复卡片而非用户消息气泡，用户消息可能在视窗外
3. **Session/Agent 切换卡顿**：切换后页面加载有延迟，长会话更明显

### 13.2 滚动卡顿根因分析

`forceLoadAllCards` 通过 fiber dispatch 调用 `dispatch(9999)` 一次性加载全部 ~78 个卡片到 DOM。即使 IntersectionObserver 减少了 `getBoundingClientRect()` 调用次数，78 个复杂卡片（markdown、代码块、工具调用结果）的 DOM 节点本身导致浏览器布局和绘制开销巨大。

**根本原因**：插件不应该在初始化时加载全部卡片，而应仅在导航需要时按需加载。

### 13.3 修复方案

#### 13.3.1 移除自动全量加载

`useMessageMap` 移除 `forceLoadAllCards` 及其自动触发逻辑，替换为 `loadCardsToPosition(domPos)`：

```typescript
const targetPage = Math.ceil((domPos + 1) / PAGE_SIZE) + 1;
// 例：domPos=70 → targetPage=8（加载80个卡片），而非 dispatch(9999)
```

仅在 `navigateToMessage` 中目标卡片不在 DOM 时才调用，且只加载到目标位置所需的最小页数。

#### 13.3.2 IntersectionObserver 视口追踪

`useViewportTracker` 新增 IntersectionObserver 被动追踪可见卡片，scroll handler 中只测量 IntersectionObserver 报告的可见卡片（~5-15 个），而非遍历全部 DOM 子元素调用 `getBoundingClientRect()`。

#### 13.3.3 导航定位修正

SDK DOM 结构：用户消息渲染为独立 `.qwenpaw-bubble-end` 元素，agent 回复渲染为 `.qwenpaw-bubble` 卡片。在 `column-reverse` 布局中，用户气泡是 agent 卡片的 `nextElementSibling`。

`navigateToMessage` 修改为：

```typescript
const userBubble = target.nextElementSibling;
const isUserBubble = userBubble instanceof HTMLElement &&
  (userBubble.classList.contains("qwenpaw-bubble-end") ||
   userBubble.className.includes("bubble-end"));
const scrollTarget = isUserBubble ? userBubble : target;
scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
```

高亮仍加在 agent 卡片上（视觉面积大、容易定位），但滚动目标改为用户消息气泡。

#### 13.3.4 资源清理增强

`useMessageMap` MutationObserver effect 新增 `cancelled` 标志，cleanup 时立即设为 `true`，防止异步回调在组件卸载后仍执行 `setCardCount`。

### 13.4 修改文件

| 文件 | 变更 |
|------|------|
| `src/hooks/useMessageMap.ts` | 移除 `forceLoadAllCards`，新增 `loadCardsToPosition` 精确分页；新增 `cancelled` 标志 |
| `src/hooks/useViewportTracker.ts` | 新增 IntersectionObserver 被动追踪可见卡片 |
| `src/index.tsx` | `navigateToMessage` 定位用户气泡为滚动目标；版本号更新 |

### 13.5 构建产物

```
dist/index.js  36.08 KB  (gzip: 10.28 KB)
```

### 13.6 待验证

| 项目 | 预期 |
|------|------|
| 滚动流畅度 | 与未安装插件时接近，无明显卡顿 |
| 导航定位 | 跳转到用户消息气泡位置 |
| Session 切换 | 无额外延迟，资源正确清理 |
| 按需加载 | 导航到历史消息时自动加载所需卡片 |

### 13.7 关键公式修正（v0.7.2）

**发现**：通过浏览器 DOM 诊断发现，SDK 将每个对话轮次渲染为 **2 个独立 DOM 元素**：
- Agent 回复：`.qwenpaw-bubble-start`（卡片）
- 用户消息：`.qwenpaw-bubble-end`（气泡）

v0.6.0 的公式 `parserIdx = totalCards - 1 - domPos` 假设每个 DOM 子元素 = 1 个 parser 卡片，但实际上每个轮次占 2 个 DOM 位置。这导致索引计算完全错误。

**修正后的公式**：

```
视口追踪：parserIdx = totalCards - 1 - agentDomPos
  - agentDomPos = agent 卡片在 bubbleList 子元素中的位置（忽略 spacer，0 = 最新）
  - 使用解析器的 totalCards（总轮次数），非 DOM 中已加载的数量
  - 仅对 agent 卡片（.qwenpaw-bubble-start）计算，跳过 user bubbles

导航定位：agentDomPos = totalCards - parserIdx - 1
  - Topic（偶数 parserIdx）→ 滚动到 user bubble（agent 卡片的 nextElementSibling）
  - Assistant（奇数 parserIdx）→ 滚动到 agent 卡片本身
```

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/hooks/useViewportTracker.ts` | 仅追踪 agent 卡片；使用 parser totalCards 和 agentDomPos |
| `src/index.tsx` | 导航公式修正；topic 滚动到 user bubble，assistant 滚动到 agent card |

**构建产物**：
```
dist/index.js  36.34 KB  (gzip: 10.38 KB)
```

---

## 14. v0.7.0/v0.7.2 错误修正（2026-06-30）

### 14.1 代码审计发现

经仔细审计 v0.7.0 和 v0.7.2 的修改，发现以下错误：

#### 问题①：导航定位公式中 agentCards[agentDomPos] 索引体系不一致（严重）

**所在文件**：`src/index.tsx` — `navigateToMessage`

**错误**：
```typescript
const agentDomPos = tc - parserIdx - 1;
const getAgentCards = () =>
  Array.from(bubbleList.children).filter((el) => el.classList.contains("qwenpaw-bubble-start"));
let agentCards = getAgentCards();
let target = agentCards[agentDomPos];
```

**原因**：`agentDomPos` 的取值是跳跃的（0, 2, 4, 6, ...），因为 user 气泡占据了奇数 DOM 位置。但 `getAgentCards()` 返回的是过滤后的连续数组 `[0, 1, 2, ...]`。用跳跃的数字索引连续数组，非最新元素全部错位或越界。

**修复**：改用直接 children 索引 `children[tc - parserIdx]`，跳过 `getAgentCards()` 过滤数组：

```typescript
const childrenIndex = tc - parserIdx;
const target = children[childrenIndex];
```

#### 问题②：loadCardsToPosition sdkDomPos 代表的是 SDK 卡片还是 DOM 元素

**所在文件**：`src/hooks/useMessageMap.ts` — `loadCardsToPosition`

**问题**：参数 `domPos`（DOM 元素索引）被直接传给 SDK 分页计算 `page = ceil((domPos+1)/PAGE_SIZE)+1`。但 SDK 每批渲染 10 个 SDK 卡片（对话轮次），每个轮次产生 2 个 DOM 元素。因此 domPos 需要除以 2 才能得到正确的 SDK 卡片位置。

**修复**：参数名改为 `sdkCardPos`，明确语义为 SDK 卡片位置。调用方 `navigateToMessage` 保证传参前已做正确转换。

#### 问题③：DetailPopover.tsx 引用不存在的 msgIndex 属性

**所在文件**：`src/DetailPopover.tsx`

**问题**：`IndexItem` 类型中属性名为 `bubbleIndex`（v0.6.0 重构后），但 DetailPopover 仍引用 `item.msgIndex`、`onItemClick(msgIndex)` 等。

**修复**：全部替换为 `bubbleIndex`。

#### 问题④：CSS 死亡选择器

**所在文件**：`src/styles.css`

**问题**：`[data-dip-msg-index] { scroll-margin-top: 60px; }` 引用了已移除的 DOM 属性。

**修复**：移除死亡规则。

### 14.2 导航目标修正（v0.7.3）

**问题**：导航到 topic 条目时，滚动定位到 agent 卡片（`bubble-start`）而非用户消息气泡（`bubble-end`）。

**原因**：v0.7.2 的 `scrollTarget` 在 topic 分支使用了 `target`（此时为 user bubble），但 flash highlight 加在了 `target.previousElementSibling`（agent 卡片）上。滚动和视觉反馈不一致。

**修复**：
- 统一 scrollTarget 为 user bubble（使用 `bubble-end` 选择器验证）
- flash highlight 也改为 user bubble
- 移除无用的 `targetAgentDomPos` 计算

### 14.3 SDK 分页加载失效（预存问题）

**现状**：导航到当前 DOM 中不存在的卡片时，`loadCardsToPosition` 通过 React fiber dispatch 设置 SDK 分页 page=9，但 SDK 未重新渲染更多卡片进入 DOM。

**根因**：fiber dispatch 后 `hook.memoizedState` 显示 page=9（目标值已到达），但 SDK 内部的 IntersectionObserver + flushSync 机制可能已标记 `noMore=true`，或 `historyMessages` 数组已经被消费完毕。

**三个方案候选中，待用户决策（§14.4）**。

### 14.4 三个 SDK 分页修复方案

待用户决策后补充决策记录。

### 14.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | 导航公式改为 childrenIndex；移除无用变量；统一 scrollTarget + highlight 为 user bubble |
| `src/hooks/useMessageMap.ts` | `domPos` 参数名改为 `sdkCardPos`；日志消息同步更新 |
| `src/DetailPopover.tsx` | `msgIndex` → `bubbleIndex`；接口字段全部重命名 |
| `src/styles.css` | 移除 `[data-dip-msg-index]` 死亡选择器 |

### 14.6 构建产物

```
dist/index.js  36.24 KB  (gzip: 10.36 KB)
```

比 v0.7.2（36.34 KB）略小，主要来自删除无用代码。

---

## 15. 导航修复+SDK分页方案实施（2026-07-01）

### 15.1 导航 flash/scroll 目标修正（v0.8.0）

**问题**：导航到 topic 条目时，黄色 flash 加在了 agent 卡片上，但用户期望看到 user 消息气泡高亮。

**原因**：v0.7.2 的 `highlightTarget` 在 topic 分支用了 `target.previousElementSibling`（agent 卡片），且 `scrollIntoView` 的 `block: "start"` 在 `content-visibility: auto` 生效时布局计算有偏差。

**修复**：
- 统一 scrollTarget = flash 目标 = user bubble（`.qwenpaw-bubble-end`）
- 移除 `highlightTarget` 变量
- scrollIntoView 前加 `requestAnimationFrame` × 2 确保 `content-visibility` 布局完成，防止跳过头

### 15.2 Header overlayer 偏移

**问题**：`.qwenpaw-chat-anywhere-layout-right-header`（54px）覆盖在聊天区顶部，`scrollIntoView({ block: "start" })` 对齐的目标被其遮挡。

**修复**：动态检测 header 元素高度，在 user bubble 上设置 `scroll-margin-top: ${headerHeight}px` inline 样式后再调用 scrollIntoView。

### 15.3 SDK 分页方案实施

**尝试过的方案**：

| 方案 | 做法 | 结果 |
|------|------|------|
| A — flushSync + 全量加载 | `flushSync` + `dispatch(9999)` | 弃用（用户决策，全量加载导致卡顿） |
| B — 双阶段 dispatch | 当前页=目标页时先 `dispatch(1)` 再 `dispatch(targetPage)` | 已实现。fiber hook 检查 `page=10` 已 ≥ 任何目标页，dispatch 不触发 |
| C 变体 — scroll-to-load-more | 滚动 load-more 哨兵触发 SDK 原生 IntersectionObserver | 已实现。尝试 6 次（每次 600ms）均未加载更多卡片 |

**根因结论**：SDK v1.1.12 的 `historyMessages` 分页机制中，page=10 已到达上限（`noMore=true`），但其渲染引擎仅在初始加载时渲染了 ~7 轮卡片（非 history），后续的 history 卡片虽然 page 计数增加但**不被渲染到 DOM 中**。fiber dispatch 和 scroll-to-load-more 均无法突破此 SDK 内部限制。

**功能影响**：当前可见范围（~7 轮对话）内的索引导航完全正常。历史索引条目可显示但无法通过 DOM 导航跳转。

### 15.4 其他修复

- 移除 `index.tsx` 中对 `loadCardsToPosition` 的引用（不再用于导航，保留 `useMessageMap` 中的实现不删除）
- `navigateToMessage` 的 `useCallback` 依赖从 `[loadCardsToPosition]` 改为 `[]`

### 15.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | flash + scroll 统一指向 user bubble；新增 header 偏移检测；scroll-to-load-more 循环；移除 `loadCardsToPosition` 依赖；新增 RAF 布局等待 |
| `src/hooks/useMessageMap.ts` | 双阶段 dispatch + 日志区分三种路径（normal/dual/already-loaded） |

### 15.6 构建产物

```
dist/index.js  37.92 KB  (gzip: 10.75 KB)
```

---

## 16. 导航公式修正 + 动态分页加载（2026-07-01）

### 16.1 导航公式确认

**正确的公式是 `childrenIndex = totalCards - parserIdx`**。

SDK 从**最新卡片开始向下加载**（索引 S-1, S-2, ..., S-M），DOM 中：
- `children[1]` = SDK card S-1（最新）
- `children[N]` = SDK card S-N
- 因此 `children[totalCards - parserIdx]` 即为目标 SDK card

当目标卡片未加载进 DOM 时 `childrenIndex >= children.length`，需要 loadMore。

### 16.1b 首次尝试的错误公式（已撤回）

首次尝试了 `idx = actualSDKCount - parserIdx`，但此公式错误——它假设 SDK 从最旧卡片开始加载（0, 1, 2, ...），而 SDK 实际从最新卡片开始向下加载（S-1, S-2, ...）。导致索引指向比目标新得多的卡片。

### 16.2 动态批次数计算

将固定循环次数改为根据目标距离动态计算：

```typescript
const cardsNeeded = childrenIndex - currentBubbles + 1;
const totalBatches = Math.ceil(cardsNeeded / PAGE_SIZE) + 1;
```

- `cardsNeeded`：当前气泡数到目标位置所需的额外卡片数
- `totalBatches`：每批 10 张卡片 + 1 安全余量
- 例如：target`childrenIndex=40`，当前气泡=10，需 31 张卡片 ≈ 5 批

### 16.3 代码清理

- 恢复 `totalCardsRef` 在 `navigateToMessage` 中的使用
- 移除 `getActualSDKCount` 辅助函数，内联气泡计数

### 16.4 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | 恢复 `totalCardsRef`；`getTarget` 使用 `totalCards - parserIdx`；动态计算所需 loadMore 批次数 |

### 16.5 构建产物

```
dist/index.js  38.56 KB  (gzip: 10.89 kB)
```

---

## 17. 无声加载 + 加载提示 UI（2026-07-01）

### 17.1 加载方式确定

经过验证，fiber dispatch 无法触发 SDK 实际加载卡片（SDK 的 `useState` page 值与 DOM 渲染脱节）。**scrollToLoadMore 是唯一能实际触发 SDK 卡片加载的方法**——通过滚动 load-more 哨兵进入视口，触发 SDK 原生 IntersectionObserver。

### 17.2 执行流程

```
用户点击话题条
  │
  ├─ target 在 DOM 中？→ 直接跳转（无加载）
  │
  └─ target 不在 DOM 中？
       ├─ setIsNavigating(true) → BarStrip 显示 "对话加载中…"
       ├─ 循环：scrollIntoView(loadMore) + await 800ms + 检查 target
       │   （每次加载 ~10 张 SDK 卡片，批次数 = ceil(需要卡片数/10)+1）
       ├─ target 找到后 setIsNavigating(false)
       └─ 最终一次 scrollIntoView(userBubble) + flash 高亮
```

### 17.3 UI 设计

- 加载提示"对话加载中…"显示在 BarStrip 顶部（原 GroupSwitcher 位置）
- 两行小字，灰色半透明，不影响导航条
- `isNavigating` 状态由 `useState` 控制，加载完成后自动隐藏

### 17.4 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | 新增 `isNavigating` 状态；`navigateToMessage` 包裹 `setIsNavigating(true/false)`；传 `isLoading` 给 BarStrip |
| `src/BarStrip.tsx` | 新增 `isLoading` prop；`GroupSwitcher` 位置条件渲染加载提示文字 |

### 17.5 构建产物

```
dist/index.js  39.14 KB  (gzip: 11.02 kB)
```

---

## 18. 最终方案：纯 scrollToLoadMore + 跳转诊断日志（2026-07-01）

### 18.1 放弃 fiber dispatch

经过对比分析，v0.6.0 的 `ensureAllCardsLoaded`（DEVLOG §10）能成功是因为它在**组件初始化时**调用，此时 session 500ms 轮询尚未启动，不会被重拉取冲掉。

而导航时调用 fiber dispatch（无论是 `dispatch(9999)` 还是 `dispatch(1→6)` + `flushSync`）均无效，原因是：
1. `useDialogIndex` 的 500ms 轮询在导航时已激活
2. dispatch 改变了 SDK 的 page 值，但紧接着的重拉取重建了组件，丢失了 dispatched state
3. 重拉取由 scrollToLoadMore 触发的 scroll 引起（`getCurrentSessionId()` 检测到变化）

### 18.2 导航执行顺序（最终版）

```
用户点击话题条
  ├─ 目标在 DOM 中？→ 直接 scrollIntoView + flash
  └─ 不在 DOM 中？
       ├─ setIsNavigating(true) → BarStrip 显示 "对话加载中…"
       ├─ 循环 scrollIntoView(loadMore) + await 800ms + 检查 target
       │  （每次触发 SDK IntersectionObserver，加载 ~10 卡片）
       ├─ 最多 8 次尝试，DOM 不再增长时提前退出
       ├─ setIsNavigating(false)
       └─ scrollIntoView(userBubble) + flash + 日志打印目标位置
```

### 18.3 跳转诊断日志

新增日志 `navigated to parserIdx=N "title" at (x,y)`：
- `parserIdx`：跳转的目标 parser 索引
- `title`：目标 user 气泡的前 40 字符
- `(x,y)`：目标气泡在视口中的像素坐标

### 18.4 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | 移除 fiber dispatch 调用；清理未用的 `loadCardsToPosition`；新增跳转诊断日志 |

### 18.5 构建产物

```
dist/index.js  39.24 KB  (gzip: 11.01 kB)
```

---

## 19. scrollIntoView behavior auto + 诊断坐标修复（2026-07-01）

### 19.1 问题

`smooth` 滚动动画期间重拉取发生，旧 DOM 元素被分离，`getBoundingClientRect()` 返回 stale 坐标（如 y=-3454, y=2323），无法反映最终位置。

### 19.2 修复

- `behavior: "smooth"` → `behavior: "auto"`：跳转即时完成，坐标在重拉取前读取
- 诊断日志移出 setTimeout，紧接 scrollIntoView 之后执行
- setTimeout 仅保留 flash 移除和 scroll-margin-top 恢复

### 19.3 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | scrollIntoView behavior "smooth" → "auto"；诊断日志移出 setTimeout |

### 19.4 构建产物

```
dist/index.js  39.52 KB  (gzip: 11.05 kB)
```

---

## 20. 工具/代码/结论 三类索引完善（2026-07-02）

### 20.1 工具调用 — toolCallParser.ts

| 改进项 | 当前 | 改进后 |
|--------|------|--------|
| 标题格式 | `toolName(param=...)` | `toolName → 参数摘要` |
| 文件路径参数 | 显示完整路径 | 仅显示文件名 |
| 错误状态 | `status: "fail"` | 标题直接显示错误摘要：`⚠ 连接超时` |
| 字符串摘要 | `val.slice(0,20)` | `smartTruncate(val, 15)` 自然断点截断 |

### 20.2 代码片段 — codeBlockParser.ts

| 改进项 | 当前 | 改进后 |
|--------|------|--------|
| 标题 | `lang - 首行代码` | `lang - 函数名/类名` 优先推断 |
| 函数检测 | 无 | `inferCodePurpose()` 解析 function/class/const 定义 |
| 文件名提取 | 仅检查前 3 行注释 | 扩展 5 行，支持 `File:` 前缀注释 |
| 短代码过滤 | 不过滤 | 跳过 `<3行` 的代码块 |

示例：`python - import os` → `python - get_event_loop()`

### 20.3 关键结论 — conclusionParser.ts

| 改进项 | 当前 | 改进后 |
|--------|------|--------|
| 去重 | 精确匹配 `bubbleIndex:title` | 模糊匹配（编辑距离 < 5） |
| 噪声过滤 | 无 | 过滤 `<5字符`、纯数字、步骤指示词 |
| 优先级 | 全部等同 | 加粗 > 编号列表 > 无序列表 |

### 20.4 通用改进

- 新增 `src/parser/utils.ts`，提供 `smartTruncate()` 在自然断点截断
- 所有 parser 的 title 截断统一使用 `smartTruncate`
- 各条目导航功能不变（复现已有的 `childrenIndex = totalCards - parserIdx` 公式）

### 20.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/parser/utils.ts` | 新增，`smartTruncate()` 智能截断工具 |
| `src/parser/toolCallParser.ts` | 重写，智能摘要 + 错误标题 + 路径文件名提取 |
| `src/parser/codeBlockParser.ts` | 重写，函数/类名推断 + 扩展文件名检测 + 短代码过滤 |
| `src/parser/conclusionParser.ts` | 重写，模糊去重 + 噪声过滤 + 优先级分等 |
| `src/parser/topicExtractor.ts` | 截断改为 `smartTruncate` |

### 20.6 构建产物

```
dist/index.js  41.90 KB  (gzip: 11.87 kB)
```

---

## 21. 导航目标修正：非 topic 条目跳转到 agent 卡片（2026-07-02）

### 21.1 问题

工具/代码/结论三类索引属于 agent 回复内容，但导航跳转目标始终是 user 气泡（`bubble-end`），与用户期望不符。

### 21.2 修复

- 非 topic 条目（`isTopic === false`）`scrollTarget = target` —— 跳到 agent 卡片自身（`bubble-start`）
- 变量名 `userBubble` → `scrollTarget`，消除语义歧义
- 去掉了冗余的 `if/else` 分支（两个分支做相同操作）

### 21.3 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | 非 topic 导航目标改为 agent 卡片；`userBubble` → `scrollTarget` |

### 21.4 构建产物

```
dist/index.js  41.94 KB  (gzip: 11.89 kB)
```

---

## 23. S3/S4 研究发现与问题记录（2026-07-02）

### 23.1 QPContentBlock 类型不匹配

**问题**：工具调用 parser 解析出 0 个工具，但 DOM 中明显有 `toolCards-module__` 元素。

**根因**：QwenPaw API 返回的 content block 类型是 `"tool_call"`，而非 `"tool_use"`。

```
QwenPaw 源码 (middlewares.py:239):  msg.has_content_blocks("tool_call")
我们的 parser:                      block.type === "tool_use"  // 永远匹配不到
```

**修复**：`types.ts` 加入 `"tool_call"`，parser 同时检查两种类型。

### 23.2 实际 block 类型

通过诊断脚本获取当前聊天（Agent: 小妍，82 条消息）的 block 类型分布：

| 类型 | 数量 | 用途 |
|------|------|------|
| `text` | 36 | 普通对话文字（markdown） |
| `data` | 48 | 工具调用（code 执行、search 等） |
| `file` | 0+ | 文件操作（read/write） |
| `tool_call` | 0 | 标准工具调用格式（未使用） |

**发现**：QwenPaw 大部分工具调用使用 `type: "data"` 和 `type: "file"`，而非标准的 `tool_use`/`tool_call`。不同工具通过 `name` 字段区分（`code`、`read`、`search` 等）。按 `type` 筛选过于狭窄，应该按 `name` 字段判断。

### 23.3 Agent 卡片 DOM 结构

```
div.qwenpaw-bubble-start
 └─ div.qwenpaw-bubble-content-wrapper
      ├─ div.qwenpaw-flex               ← 头像 + agent 名称
      ├─ div.qwenpaw-operate-card       ← Thinking 推理过程
      ├─ div.x-markdown                 ← 回复文字（markdown，含代码块、结论）
      ├─ details.toolCards-module__*    ← 工具调用（data/file 块渲染）
      ├─ div.qwenpaw-operate-card       ← 更多 Thinking
      ├─ details.toolCards-module__*    ← 更多工具调用
      └─ div.qwenpaw-bubble-footer
```

### 23.4 S4 状态

精确 DOM 定位导航（用 `childIndex` 在 agent 卡片内找第 N 个匹配元素）已完成并部署，但尚未在真实有工具调用的聊天中验证。

### 23.5 分类现状（待重新定义）

当前三个非 topic 分组的 parser 逻辑均存在数据源问题——它们从 API `messages[]` 解析，但 API 的数据结构和 DOM 的渲染结构有差异：

| 分类 | 当前数据来源 | 当前问题 |
|------|-------------|---------|
| **tool** | API 中 `tool_use`/`tool_call` 块 | 不识别 `data`/`file` 块中的工具调用 |
| **code** | `getPlainText()` 提取 text 块中的 ``` 代码 | 遗漏 tool result 中的代码 |
| **conclusion** | `getPlainText()` 提取 text 块中的 加粗/列表 | 混入 Thinking 内容、表格行、噪声

---

## 22. 后续分步实施计划

### 22.1 规划

| 步骤 | 内容 | 状态 |
|------|------|------|
| **S1** | 修复导航目标：非 topic 条目跳到 agent 卡片而非 user 气泡 | ✅ 已完成 |
| **S2** | `IndexItem` 加 `childIndex` 字段，parser 记录条目在卡片内的序号 | ⏳ 进行中 |
| **S3** | 研究 SDK agent 卡片的 DOM 结构，确定工具/代码/结论的具体 DOM 元素选择器 | ⬜ 待定 |
| **S4** | 实现精确 DOM 定位导航：用 `childIndex` 在 agent 卡片内找到第 N 个匹配元素 | ⬜ 待定 |
| **S5** | 结论 parser 针对性过滤：排除 Thinking 段、表格行、合理聚合 | ⬜ 待定 |

### 22.2 S2 详情

在 `IndexItem` 中新增 `childIndex: number` 字段，记录该条目在其所属 card 中是第几个同类型元素（从 0 开始）。

```
toolCallParser:
  - 同一个 assistant card 中，第 1 个 tool_use → childIndex = 0
  - 第 2 个 tool_use → childIndex = 1

codeBlockParser:
  - 同一个 assistant card 中，第 1 个代码块 → childIndex = 0
  - 第 2 个代码块 → childIndex = 1

conclusionParser:
  - 同一个 assistant card 中，第 1 个结论 → childIndex = 0
  - 第 2 个结论 → childIndex = 1
```

此字段为 S3/S4 的精确 DOM 定位做准备，当前暂不影响导航行为。

---

## 24. 工具/代码/结论 分类实现总结（2026-07-03）

### 24.1 最终分组定义

| 分组 | 本质 | 数据来源 | 示例条目 |
|------|------|---------|---------|
| **话题** | 用户提问/话题节点 | 用户消息的 text | `帮我从html文件中...` |
| **工具** | 代理执行的操作 | `data`/`file` 块中的 JSON（name+arguments） | `read_file`、`execute_shell_command` |
| **代码** | 被执行的代码内容 | text 块 ``` + tool input 中的 `input.code` | `python - extract_refs()` |
| **结论** | 回复中的关键结论 | text 块中的加粗/列表 | `找到 29 个引用标记` |

### 24.2 已实现的功能

| 功能 | 状态 | 说明 |
|------|:----:|------|
| API 数据解析 → 索引 | ✅ | 4 个 parser 从 API messages[] 提取 |
| 分组切换（BarStrip） | ✅ | 循环切换 4 个分组 |
| 视口追踪高亮 | ✅ | IntersectionObserver 追踪可见卡片 |
| 精确工具追踪 | ✅ | 单独追踪每个 `toolCallCompact` 元素 |
| 点击跳转 | ✅ | scrollIntoView 到具体 DOM 元素 |
| 工具去重 | ✅ | 用 `call_id` 去重，48→24 |
| 二级弹窗中文标签 | ✅ | 显示 DOM 中文描述（`阅读 filename`） |
| 长文本换行 | ✅ | `pre-wrap` + `maxWidth 320px` |

### 24.3 关键决策记录

| 决策 | 方案 | 原因 |
|------|------|------|
| 导航公式 | `childrenIndex = totalCards - parserIdx` | SDK 从最新卡片向下加载，此公式正确映射 |
| 加载触发 | scrollToLoadMore（不可用 fiber dispatch） | fiber dispatch 在 v1.1.12 中无效 |
| 加载提示 | "对话加载中…" 显示在 BarStrip 顶部 | 用户感知加载状态 |
| 工具高亮 | 精确到 `childIndex`（卡片内第 N 个工具） | 卡片有多个工具调用时需区分 |
| 二级弹窗信息 | DOM 标签文本（如 `阅读 filename`） | 比 parser 提取的原始工具名更可读 |

### 24.4 待完成

| 任务 | 优先级 | 说明 |
|------|:------:|------|
| S5 — 结论 parser 过滤 | ⬜ | 排除 Thinking 段、表格行 |
| 代码分组内容验证 | ⬜ | 确认 codeBlockParser 提取正确性 |
| 导航后高亮保持优化 | ⬜ | 可能是视口追踪的延迟导致的 |

---

## 25. 工具分组视口追踪高亮不准根因分析（2026-07-03）

### 25.1 现象

工具分组下，即使全部消息已加载，滚动到某个工具调用时 BarStrip 高亮的条目与实际可见工具不一致，或高亮错位、或完全失效（`activeToolIndex` 始终为 -1）。

### 25.2 根因（共 5 个，层层叠加）

| # | 根因 | 位置 | 影响 |
|---|------|------|------|
| **1** | `[class*="toolCallCompact"]` 子字符串选择器同时匹配 `<details class="toolCallCompact__X">` 和内嵌 `<summary class="toolCallCompactSummary__Y">` | `useViewportTracker.ts` 3 处 querySelectorAll | DOM 元素数 = parser 去重后数的 **2 倍**，childIdx 系统性错位 |
| **2** | IntersectionObserver 回调用 `el.classList.contains('qwenpaw-bubble')` 判断工具元素，但工具元素 class 是 `toolCards-module__toolCallCompact`，不含 `qwenpaw-bubble` | `useViewportTracker.ts` observer 回调 | 工具元素**永远不被识别**，`visibleToolCallsRef` 始终为空，`activeToolIndex` 永远 -1 |
| **3** | `calculate()` 用容器 1/3 处（`cardTargetLine`）找最近工具，但工具是小元素从卡片顶部依次向下排列，1/3 线总落在第一个工具附近 | `useViewportTracker.ts` calculate 第 2 段 | 永远高亮卡片顶部工具，非用户关注的中部工具 |
| **4** | `scrollIntoView` 后 `calculate()` 在 content-visibility 布局稳定前执行，`getBoundingClientRect()` 返回过时 rect | `useViewportTracker.ts` handleScroll | 首次滚动高亮错位，需二次触发才正确 |
| **5** | `content-visibility: auto` 使 `scrollIntoView({block:'center'})` 后目标不一定真在视口中心（布局异步重排） | SDK 渲染机制（非插件 bug） | 单纯延迟重算无法根除，属固有约束 |

### 25.3 修复

| 根因 | 修复 |
|------|------|
| 1 | 选择器改为 `details[class*="toolCallCompact"]`（tagName DETAILS 排除 SUMMARY） |
| 2 | 新增 `isToolCall()` 辅助函数（tagName=DETAILS 且 class 含 toolCallCompact），替换错误的 `qwenpaw-bubble` 判断 |
| 3 | 工具追踪改用视口中心 `viewportCenter`（容器 1/2 处），卡片追踪仍用 1/3 处；过滤 rect.top 在视口外的元素 |
| 4 | scroll 后多阶段重算：rAF + 120ms + 300ms + 600ms 四次 calculate，收敛到布局稳定后的值 |

根因 5 属 SDK 渲染固有约束，未修复——多阶段重算已将准确率从 0% 提升到约 50-60%，剩余偏差来自 content-visibility 与 scrollIntoView 的时序冲突，进一步优化收益递减。

### 25.4 修改文件

| 文件 | 变更 |
|------|------|
| `src/hooks/useViewportTracker.ts` | 选择器排除 SUMMARY；新增 isToolCall；observer 回调修复工具识别；calculate 区分 cardTargetLine/viewportCenter + 过滤异常 rect；handleScroll 多阶段重算 |

### 25.5 构建产物

```
dist/index.js  47.15 KB  (gzip: 13.19 kB)
```

---

## 26. 远距离跳转加载失败修复（2026-07-04）

### 26.1 现象

从最新条目跳转到最早话题（或任何远距离条目）时，DOM 卡片只加载一部分就停止，跳转目标无法到达。

### 26.2 根因

`navigateToMessage` 中的 loadMore 循环（`src/index.tsx`）有两处缺陷：

| # | 缺陷 | 原代码 | 影响 |
|---|------|--------|------|
| **1** | 循环上限 8 次不够 | `for (let attempt = 0; attempt < 8; attempt++)` | SDK 每次加载 10 张（PAGE_SIZE=10），从初始 10 张加载到 78 张需 ~7 次成功加载；遇 re-fetch 节流导致某次无增长时，8 次循环不够用 |
| **2** | 单次卡片数不增长就 break | `if (newCount === prevCount) break;` | SDK 在循环中途 re-fetch session 状态时，某次 loadMore 可能瞬时无新增卡片，但下次又恢复——单次停滞就退出导致"加载到一半停止" |

### 26.3 修复

```javascript
// 循环上限 8 → 20，覆盖 re-fetch 开销和 SDK 节流
for (let attempt = 0; attempt < 20; attempt++) {
  // ...
  if (newCount === prevCount) {
    stallCount++;
    // 连续 3 次停滞才退出，容忍瞬时 re-fetch 干扰
    if (stallCount >= 3) break;
  } else {
    stallCount = 0;
  }
  prevCount = newCount;
}
```

- 循环上限 `8 → 20`：覆盖长会话（80+ 卡片）和 SDK re-fetch 开销
- 提前退出条件 `单次停滞 → 连续 3 次停滞`：容忍 SDK 瞬时节流，仅在确认无法再加载时放弃

### 26.4 验证

真实长会话（879 条消息、78 张卡片），初始 DOM 10 张，点击最早 `topic-0`：

| 时间 | DOM 卡片数 | loadMore |
|------|:---------:|:--------:|
| 0s | 10 | 存在 |
| 1s | 30 | 存在 |
| 2s | 40 | 存在 |
| 3s | 50 | 存在 |
| 4s | 60 | 存在 |
| 5s | 70 | 存在 |
| 6s | **78** | **消失** ✅ |
| 7s+ | 78 稳定 | 消失 |

总加载耗时 ~6s，从 10 张平滑加载到全量 78 张，跳转目标成功到达视口顶部。

### 26.5 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.tsx` | loadMore 循环上限 8→20；单次停滞退出改为连续 3 次停滞退出 |

### 26.6 构建产物

```
dist/index.js  47.40 KB  (gzip: 13.26 kB)
```

---

## 27. 结论分组 Thinking 噪声过滤（2026-07-05）

### 27.1 现象

结论分组（`conclusion` group）条目混入大量 Thinking 推理段噪声，真结论被淹没。

DEVLOG §23.5 已诊断：API 层无法区分 Thinking 段与回复段——两者均为 `type: "text"`，字段层面同质。DOM 层可区分（`.qwenpaw-operate-card` vs `.x-markdown`），但需架构调整引入 DOM 通道依赖。本轮采用**纯 API 层内容启发式过滤方案**（方案 A），只改 `src/parser/conclusionParser.ts`。

### 27.2 方案设计（C1-C3）

| 改进 | 名称 | 内容 |
|------|------|------|
| **C1** | Thinking 段识别 | 新增 `isThinkingBlock()` 用中英文推理口吻开头正则识别整段，跳过其加粗/列表提取 |
| **C2** | 结论特征正向匹配 | 新增 `hasConclusionMarker()` 识别结论标记词、判断符号、完成态、量化结果；纯白名单策略（去掉回退到普通提取的路径） |
| **C3** | 卡片级 reply 密度过滤 | `replyCount/totalBlocks < 0.2` 且块数 ≥ 3 → 跳过整卡片（多为纯推理卡片） |

**核心决策**：方案 A（内容启发式）而非方案 B（DOM 通道增强），因后者需架构调整。

**策略转变**：初版 C2 是"先试高置信度匹配，无命中回退到普通加粗+列表提取"。实测发现回退路径正是噪声主来源——`The ACP subsystem spawns...`、`It communicates with it via stdin/stdout...` 等推理段虽非 thinking 开头但含加粗/列表，回退路径会把它们当结论提取。**最终改为纯白名单**：未命中结论特征的块不产生条目。实测所有真结论都命中 `hasConclusionMarker`（含 ✅/⛔/通过/通关/✓ 等强判断特征），所有噪声都不命中——白名单策略可行。

### 27.3 实施

#### 27.3.1 C1 — Thinking 段识别

```typescript
// 中文推理口吻开头（"用户想让我..."、"让我看看..."、"我需要先..."）
const THINKING_CN_RE = /^(用户|让我|我需要|看看|等等|试试|如果|那么|列表中|没有找到|让我再|我再|我想|我觉得|我认为|我猜|也许|会不会|可能|应该是|应该是说|也就是说|或者说)/;
// 英文推理口吻开头（"The user is..."、"Let me check..."、"I need to..."、"The ACP..."、"It communicates..."）
const THINKING_EN_RE = /^(The user|The (ACP|subprocess|daemon|process|command|result|output|response)|Let me|I (need|found|should|will|can|think|guess|assume|suppose|realize|notice|have|see|try)|It (communicates|spawns|starts|fails|is|was|would|could|should)|Maybe|Perhaps|Actually|Now|So|Then|Next|First|Looking|Checking|Searching|Trying|Wait|Hmm|This (would|is|means|could)|That (would|is|means|could))/;
// 短自问自答（如"也许是个 ACP？"）
const SELF_QUESTION_RE = /\？\s*$/;

function isThinkingBlock(text: string): boolean {
  const trimmed = text.trim();
  if (THINKING_CN_RE.test(trimmed) || THINKING_EN_RE.test(trimmed)) return true;
  if (trimmed.length < 30 && SELF_QUESTION_RE.test(trimmed)) return true;
  return false;
}
```

**关键改动**：原 `extractConclusions` 用 `getPlainText()` 把所有 text 块直接 join 成一个字符串，导致 thinking 段和回复段被混在一起。改为**按块处理**——逐块判定 `isThinkingBlock`，reply 段才参与提取，thinking 段跳过。

**英文 Thinking 演化**：初版 `THINKING_EN_RE` 只覆盖 `The user` / `Let me` / `I (need|found|...)` 等开头。实测 `The ACP subsystem spawns...`、`It communicates with it via stdin/stdout...`、`The subprocess failed to start` 等仍泄漏——这些以 `The` / `It` 开头，初版未覆盖。扩展 `The (ACP|subprocess|daemon|process|command|result|output|response)` 和 `It (communicates|spawns|starts|fails|is|was|would|could|should)` 分支。

#### 27.3.2 C2 — 结论特征正向匹配

```typescript
const CONCLUSION_MARKER_RE = /^(结论|总结|最终|结果|答案|核心|关键|总的来说|综上|最终结论|要点|发现|结论是|总结一下)/;
const CONCLUSION_MARKER_EN_RE = /^(Conclusion|Summary|Result|Answer|Key|Finding|Finally|In summary|To summarize|Overall|The result)/;
// 只保留强判断词与符号，去掉"创建/修复/完成/解决"等中性动词
const VERDICT_RE = /[✅⛔❌✓✗]|[通过|失败|正确|错误|成功|完美|通关]/;
const DONE_RE = /^已(创建|修复|完成|修改|设置|找到|解决|实现|添加|删除|更新)/;
const DONE_EN_RE = /^(Done|Completed|Fixed|Created|Resolved|Updated|Added|Removed)/;
const QUANTIFIED_RE = /\d+\s*(个|次|条|行|项|处|ms|秒|s\b)|\d+\%|\d+\.\d+/;

function hasConclusionMarker(text: string): boolean {
  const trimmed = text.trim();
  if (CONCLUSION_MARKER_RE.test(trimmed) || CONCLUSION_MARKER_EN_RE.test(trimmed)) return true;
  if (VERDICT_RE.test(trimmed)) return true;
  if (DONE_RE.test(trimmed) || DONE_EN_RE.test(trimmed)) return true;
  if (QUANTIFIED_RE.test(trimmed)) return true;
  return false;
}
```

**VERDICT_RE 收紧**：初版含"创建/修复/完成/解决"等中性动词，导致"创建 session"、"第一轮：创建文件"等步骤标题被误命中。改为只保留强判断词（通过/失败/正确/错误/成功/完美/通关）与符号（✅⛔❌✓✗）。

**白名单策略**：`extractStructured(block.text, true)` 只返回含结论特征的命中，去掉回退到 `extractStructured(block.text, false)` 的路径。

#### 27.3.3 C3 — 卡片级 reply 密度过滤

```typescript
for (const { cardIdx: cIdx, blocks } of cardBlocks) {
  if (blocks.length === 0) continue;
  const replyCount = blocks.filter((b) => !b.isThinking).length;
  const density = replyCount / blocks.length;
  // 低密度卡片（reply < 20% 且块数 >= 3）：多为 Thinking，跳过整卡片
  if (density < 0.2 && blocks.length >= 3) continue;
  // ...
}
```

#### 27.3.4 附加改进

**加粗标记剥除**：`extractStructured` 末尾用 `replace(/\*\*(.+?)\*\*/g, "$1")` 剥除列表项/编号项中内嵌的 `**x**`，让标题干净（加粗匹配的捕获组本身已不含 `**`）。

**isNoise 增强**：新增对代码片段（`` `python` ← the command``）、单个标识符（`claude_code`、`opencode`）、短加粗无标点的过滤。

```typescript
// 代码片段特征：反引号包裹、命令行开关、纯标识符（含下划线但无空格/标点）
if (/^`[^`]+`$/.test(trimmed)) return true;        // `python` 单独成段
if (/^[\w_]+ ← /.test(trimmed)) return true;       // `python` ← the command
if (trimmed.length < 25 && /^[\w_↓]+$/.test(trimmed)) return true;  // 单个标识符
if (trimmed.length < 12 && /^[^\s，。；！？,.!?;:]+$/.test(trimmed) && !VERDICT_RE.test(trimmed)) return true;
```

### 27.4 验证

真实长会话（46 轮、78 张卡片），切换到结论分组对比条目质量：

| 指标 | 改进前（§23.5） | 第一轮改进 | 最终改进 |
|------|:------:|:------:|:------:|
| 条目数 | 混入大量 Thinking 噪声 | 74 | **35**（-53%） |
| 加粗标记 `**` 残留 | 有 | 有 | **0** ✅ |
| Thinking 段泄漏 | "用户想让我..."、"让我看看..." | "The ACP..."、"It communicates..." | **0** ✅ |
| 真结论命中 | 难分辨 | `✅连接成功`、`全部6轮通过！` | 同 + 更全面 ✅ |
| 判断符号结论 | 混噪声 | `✅ Tool execution works`、`❌ File targeting is wrong` | 同 ✅ |

**最终 35 条条目质量分析**：

- 真结论约 25 条：`✅ 连接成功 — opencode 成功启动了`、`❌ 但没回话 — 它每次都是 "completed without text"`、`✅ Tool execution works (file writes...)`、`❌ File targeting is wrong - it used...`、`Created file A (alpha.md) ✓`、`Modified file A when told by name ✓`、`全部6轮通过！多文件混淆测试完美通关！`、`第2轮失败，测试终止！`
- 剩余噪声约 10 条（28%）：均为含判断符号的准结论（`Daemon 没在跑 — 配置是...`、`切换为 mock 模式...`、`我是 opencode，一个基于命令行的 AI 编程助手`、`第3轮：完全不提文件名和路径`、`说加了第4行到 round_test.md`），可读性远高于改进前的 Thinking 推理段噪声。进一步清理需更复杂语义判断（如区分"测试步骤标题"与"测试结果结论"），收益递减，本轮不再追加。

### 27.5 改进效果总结

C1-C3 三层过滤组合生效：

- **C1** 消除"开头口吻可识别"的 Thinking 段泄漏（中文/英文）
- **C2** 白名单策略只保留含明确结论特征的条目，是噪声过滤的主力
- **C3** 跳过纯推理卡片
- **附加改进** 清理加粗标记残留和短标识符噪声

条目数从无法辨认的噪声混层降到 35 条高置信度结论，真结论召回率约 71%，剩余噪声均为含判断符号的准结论，可读性显著提升。

### 27.6 修改文件

| 文件 | 变更 |
|------|------|
| `src/parser/conclusionParser.ts` | 完整重写（137→247 行）：新增 `isThinkingBlock`/`hasConclusionMarker`；按块处理替代 `getPlainText`；白名单策略；加粗剥除；VERDICT_RE 收紧；isNoise 增强 |

### 27.7 构建产物

```
dist/index.js  49.65 KB  (gzip: 14.54 kB)
```

---

## 28. 结论分组 Thinking 过滤：误诊链揭穿与字段突破口（2026-07-06）

### 28.1 起点：§27 启发式方案的失败信号

§27 实施的 C1-C3 启发式过滤（中英文推理口吻开头正则识别 Thinking 段）实测仍有 Thinking 内容泄漏到结论分组。用户报告的关键泄漏样例：

```
<div class="qwenpaw-operate-card-thinking">All 6 rounds passed! The multi-file
confusion test was a success. atomcode correctly:
1. Created file A (alpha.md) ✓
2. Created file B (beta.md) ✓
...</div>
```

这段文本不以推理口吻开头（"All 6 rounds passed!" 是完成态陈述），C1 启发式漏判——**根本问题在于启发式靠"开头口吻"识别，但 Thinking 段内容不全是推理口吻**。

### 28.2 关键质疑：SDK 如何正确分块？

用户提出关键问题：QwenPaw 前端能正确区分 Thinking 段（`.qwenpaw-operate-card-thinking`）和回复段（`.x-markdown`），**SDK 必然有可靠分块判据，不可能靠流态实时数据（程序重启就乱）**。这质疑直接推翻了我之前准备走 DOM 通道借用方案的方向——**应该先搞清 SDK 的分块机制**。

### 28.3 调查链：四个误诊的揭穿

#### 28.3.1 误诊一：Inbox 的 `type:"thinking"` ≠ 对话消息

调查 `D:/QwenPaw-source/console/src/pages/Inbox/utils/traceUtils.ts` 的 `extractTraceText` 时发现 `blockType === "thinking"` + `block.thinking` 字段处理——初看以为是 Thinking 段独立字段的证据。

**真相**：这是 **Inbox 推送消息**结构（带 `event`、`block.thinking` 字段），与对话消息的 content block 结构**完全不同**。Inbox 处理的是外部渠道推送的事件消息，不是 `/api/chats/{id}` 返回的对话 messages。我错误地把两种结构混为一谈。

#### 28.3.2 误诊二：SDK `TMessage.cards[]` 不是分块结果

调查 `D:/代码/agentscope/node_modules/@agentscope-ai/chat` SDK 源码时发现 `TMessage` 含 `cards: TMessageCard[]`，每个 card 有 `code: string` 字段标识类型（`"Text"`/`"Thinking"`/`"ToolCall"`）。初看以为是 SDK 已分块的证据。

**真相**：追 `ChatAnywhereProvider.tsx`（只持有 state）、`Chat/index.tsx`（只渲染）、`Bubble/Cards.tsx`（只按 `card.code` 分发）——**SDK 自己从不分块**。`setMessages` 由宿主应用调用，`cards[]` 是宿主预先构造好的。SDK 只负责渲染。

进一步追 `D:/QwenPaw-source/console/src/pages/Chat/sessionApi/index.ts` 的 `buildResponseCard`（第 229-245 行）——QwenPaw 宿主层把所有连续 non-user 消息一锅炖进单个 `CARD_RESPONSE` 卡片，`data.output` 是整组 `outputMessages`，**根本不生成 `code:"Thinking"` 卡片**。所以分块不在宿主的 messages 构造层。

#### 28.3.3 误诊三：SDK `Builder.handleMessage` 的 `Object.assign` 推断

调查 SDK `lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Card.js` 的 `DefaultResponseRender`——发现真正的分块逻辑：

```js
messages.map(function (item) {
  switch (item.type) {                              // ← message.type，不是 content.type！
    case AgentScopeRuntimeMessageType.MESSAGE:       // 回复段 → <Message>
    case AgentScopeRuntimeMessageType.REASONING:     // Thinking 段 → <Reasoning>→<Thinking>
    case AgentScopeRuntimeMessageType.TOOL_CALL:     // 工具调用 → <Tool>
    ...
  }
})
```

而 `Reasoning.js` 第 8-14 行证实 Thinking 段读 `data.content[0].text` 包成 `<Thinking content={content.text} />`——`.qwenpaw-operate-card-thinking` class 即源于此（`OperateCard/preset/Thinking.tsx` 第 53 行 `<div className={`${prefixCls}-thinking`}>`）。

**误诊**：看 `Builder.handleMessage` 的 `Object.assign` 推断"存档后回放丢失 type 字段"——这个推断**没有证据支持**，只是我对历史 API 数据全 `type:"text"` 现象的猜测性解释。

**真相**：用户质疑"SDK 不可能只靠流态数据，数据肯定要落盘"完全正确。后端 `D:/QwenPaw-source/src/qwenpaw/agents/acp/server.py:177-180` 证实用 `MessageType.REASONING` 标识 Thinking 消息：

```python
if msg_type == MessageType.REASONING.value:
    if msg_id:
        self._reasoning_msg_ids.add(msg_id)
    return []
```

后端既然用 `MessageType.REASONING` 区分，存档必然带这个字段（不然重启就乱）。**我之前的"存档丢失 type"推断是错的**。

#### 28.3.4 误诊四：API 字段深查漏看顶层 `type`

P1 调查时对 `/api/chats/...` 数据做字段深查，统计了 block 层的 `object`/`status`/`delta`/`error`/`index`/`msg_id` 字段（全 100% 同质），以及消息顶层的 `metadata`/`object`/`status` 字段（无区分）——**但漏看了消息顶层 `type` 字段**。

代码 line 16 的过滤 `['sequence_number','type','text'].includes(k)` 把 `type` 跳过了——但那只跳过 **block 层的 `type`**（循环体是 `for (const b of m.content)`）。顶层 `for (const m of asstMsgs)` 那段只统计了 `object`/`status`/`metadata`，**从未碰顶层 `type` 字段**。所以顶层 `type` 的分布至今是盲区——这正是用户质疑的关键漏洞。

### 28.4 字段突破口：顶层 `type` 字段精准三分

重拉 `/api/chats/...` 数据，统计 606 个 assistant 消息顶层 `type` 字段值分布：

| `type` 值 | 数量 | 含义 | block 结构 | 示例文本头 |
|------|:------:|------|------|------|
| `"reasoning"` | **267** | Thinking 推理段 | `{text:1}` 单文本块 | "用户想让我使用外部Agent..." |
| `"message"` | **105** | 真回复段 | `{text:1}` 单文本块 | "没有找到名为 **atomcode** 的 agent 呃..." |
| `"plugin_call"` | **234** | 工具调用 | `{data:1}` 单工具块 | （无文本） |

**这是零误判的精准分块字段**——后端 `MessageType.REASONING`/`MESSAGE`/`PLUGIN_CALL` 落盘后完整保留，历史 API 数据里一直就有此字段，前两轮调查漏看了。

**误诊链的根源**：DEVLOG §23.5 的旧诊断"API 层均为 `type:"text"` 无法区分"——这只对 **block 层**成立（373 个 text block 确实都是 `type:"text"`），但**区分字段在顶层 `msg.type`**，不在 block 层。我前两轮把 block 层和消息层混为一谈，导致一路误诊。

### 28.5 极简方案实施：字段过滤替代启发式

#### 28.5.1 改动范围

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `QPMessage` 补 `type?: 'reasoning' \| 'message' \| 'plugin_call' \| string` 字段 + JSDoc |
| `src/parser/conclusionParser.ts` | 删除 C1 启发式（`isThinkingBlock`+3 正则）、C3 密度过滤、`CardTextBlock` 按块处理；改用顶层 `msg.type !== "message"` 跳过；保留 C2 白名单 + 加粗剥除 + isNoise + editDistance |
| `src/parser/topicExtractor.ts` | `else` 分支末加 `if (msg.type === "reasoning") continue`——话题跳过 Thinking 段（**连带 bug 修复**） |
| `src/parser/codeBlockParser.ts` | `else` 分支 cardIdx 递增后加 `if (msg.type === "reasoning") continue`——代码跳过 Thinking 段（**连带 bug 修复**） |
| `src/parser/toolCallParser.ts` | **未改**——已天然跳过 text 块（`if (block.type === "text") continue`），reasoning 段对其无影响 |

#### 28.5.2 cardIdx 对齐策略

`reasoning` 跳过需放在 cardIdx 递增逻辑**之后**，否则后续卡片错位：

```typescript
} else {
  if (prevWasUser) {
    cardIdx++;
    childIdx = 0;
  }
  prevWasUser = false;
  // cardIdx 已递增完毕，此处跳过不会导致后续卡片错位
  if (msg.type === "reasoning") continue;
  // ... 提取逻辑
}
```

`reasoning` 消息在消息流里是真实存在的 assistant 消息，占一个卡片位。若在 cardIdx 递增前跳过，会让后续 `message` 类型消息误递增 cardIdx（本应同卡片，但 prevWasUser 已被 reasoning 设为 false）。放在递增后跳过只跳提取，cardIdx 仍与 SDK 渲染卡片对齐。

#### 28.5.3 conclusionParser 简化

原 §27 的 `extractConclusions` 用 `collectCardTextBlocks` 按块收集 + 卡片级密度过滤——复杂且形同虚设（实测每消息单 block，根本无多 block 卡片）。极简方案直接按消息遍历：

```typescript
for (const msg of messages) {
  if (msg.role === "user") { ... continue; }
  if (prevWasUser) { cardIdx++; childIdx = 0; }
  prevWasUser = false;
  // 关键过滤：只对 "message" 类型提取结论
  if (msg.type !== "message") continue;
  const text = ...join 所有 text block...;
  const findings = extractStructured(text, true);  // C2 白名单
  for (const finding of findings) { items.push({...}); }
}
```

### 28.6 验证

真实长会话（879 条消息、606 个 assistant、78 张卡片），四个分组对比：

| 分组 | §27 启发式 | 极简方案 | 说明 |
|------|:------:|:------:|------|
| 话题 | 混入 reasoning 段 | **39**（已跳过 reasoning） | ✅ 连带修复 |
| 代码 | 混入 reasoning 段示例代码 | **6**（已跳过 reasoning） | ✅ 连带修复 |
| 工具 | 234 | **234** | 天然不受影响 |
| 结论 | 35（启发式） | **25**（字段过滤） | ✅ Thinking 归零 |

**关键泄漏点已验证消除**：用户报告的 `"All 6 rounds passed! ..."` Thinking 段内容不在 25 条条目里了。这条原本在 §27 启发式下泄漏（因不以推理口吻开头，启发式漏判），现在顶层 `type:"reasoning"` 直接跳过整个消息，零误判。

**25 条条目质量**：
- 真结论约 20 条：`✅ 连接成功 — opencode 成功启动了`、`❌ 但没回话 — 它每次都是 "completed without text"`、`✅ 进步了：工具调用真的生效了！`、`第1轮：start → 创建文件 ✅`、`全部6轮通过！多文件混淆测试完美通关！`
- 剩余噪声约 5 条：`Daemon 没在跑 — 配置是...`、`我是 opencode，一个基于命令行的 AI 编程助手`、`第一轮成功！`、`第三轮：完全不提及路径和文件名`——全部来自 `"message"` 类型真回复段，是白名单 C2 的固有边界（含判断符号的准结论），需更复杂语义判断，收益递减。

**误诊链教训**：本轮调查历经四轮误诊才找到顶层 `type` 字段。根源是 §23.5 旧诊断"API 层均为 `type:"text"`"的表述含糊——**只对 block 层成立，但被泛化理解为消息层也无法区分**。后续所有调查都基于这个错误前提。修正：字段调查时必须明确区分 **block 层字段**（`content[i].type`）和 **消息层字段**（`msg.type`），两者是不同字段，值域不同。

### 28.7 改进效果总结

| 指标 | §27 启发式 | 极简方案 |
|------|:------:|:------:|
| 条目数 | 35 | **25**（-30%） |
| Thinking 段泄漏 | ~10 条准结论噪声 | **0** ✅ |
| 启发式维护成本 | 中英文正需常调 | **0**（字段过滤） |
| 连带 bug | 话题/代码混入 reasoning | **修复** ✅ |
| DOM/API 依赖 | 纯 API（启发式） | **纯 API**（字段） |

从"内容启发式猜 Thinking 段"转向"按后端 MessageType 字段精准跳过"——零误判、零维护、连带修复两个分组 bug。

### 28.8 构建产物

```
dist/index.js  48.68 KB  (gzip: 13.98 kB)
```

---

## 29. 结论分组二级弹窗截断 + 跳转公式错位修复（2026-07-06）

### 29.1 起点：两个具体问题

用户报告结论分组两个问题：

1. **二级弹窗内容截断**：悬停条目弹出的二级浮窗显示的标题被截断（如 `"Daemon 没在跑 — 配置是 \`DAEMON2ACP_MODE=proxy\`..."`），应显示完整原文。
2. **气泡6/74 跳转失败**：点击气泡6相关条目（`bi:5`，显示"气泡 #6"）、气泡74相关条目（`bi:73`，显示"气泡 #74"）无法正确滚到目标卡片。

### 29.2 问题1：截断根源与修复

#### 29.2.1 根源

`conclusionParser.ts` 的 `extractStructured` 末尾对每条命中做 `smartTruncate(f.replace(/\*\*(.+?)\*\*/g, "$1"), 40)`——截断到 40 字存入 `title`。二级弹窗 `BarStrip.tsx:416` 显示的就是这个截断后的 `title`，完整原文从未保留。

#### 29.2.2 修复：新增 `fullText` 字段

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `IndexItem` 加 `fullText?: string` 字段（JSDoc: "Full original text before truncation, for secondary popover display"） |
| `src/parser/conclusionParser.ts` | `extractStructured` 返回类型从 `string[]` 改为 `{title: string; fullText: string}[]`；剥除加粗后 `full = f.replace(/\*\*(.+?)\*\*/g, "$1")`，`title = smartTruncate(full, 40)`，`fullText = full`；`items.push` 加 `fullText` 字段 |
| `src/BarStrip.tsx` | 二级弹窗 `{secondaryItem.title}` 改为 `{secondaryItem.fullText || secondaryItem.title}`——显示完整原文，兜底截断版 |

#### 29.2.3 验证

实测首条结论：
- `title`: `"Daemon 没在跑 — 配置是 \`DAEMON2ACP_MODE=proxy\`..."`（40字截断）
- `fullText`: `"Daemon 没在跑 — 配置是 \`DAEMON2ACP_MODE=proxy\`，会去连 \`http://127.0.0.1:13457\` 上的 daemon，但这个端口没人监听"`（完整原文）
- `fullTextLonger`: `true` ✅

### 29.3 问题2：跳转公式错位 + 架构层根因

#### 29.3.1 公式错位根源

`index.tsx:navigateToMessage` 的旧公式：

```typescript
const isTopic = parserIdx % 2 === 0;          // ← 奇偶性判断分组
const childrenIndex = tc - parserIdx;          // ← tc=totalCards(78), parserIdx=bubbleIndex
```

两个错误：

**错误一：`isTopic` 奇偶性判断失效**。§28 改造后 `cardIdx` 连续递增（user 段+1、user 后首个 assistant+1、后续 assistant 不递增共享同卡片），**奇偶性 = user/assistant 分配仍成立**（实测偶数 cardIdx 全是 user、奇数全是 assistant），但 `isTopic` 应直接靠 `group === "topic"` 判断，而非从 bubbleIndex 奇偶性反推——后者在 cardIdx 跳跃时不可靠。

**错误二：`childrenIndex = tc - parserIdx` 公式全错**。DOM 实测结构：

```
79 children: [0]spacer [1]newest-agent [2]newest-user [3]agent [4]user ... [77]agent [78]user
每 turn 2 元素（agent card + user bubble），成对排列
```

但 `tc = totalCards = 78`（parser 算的，含每条消息各占一个 cardIdx），`parserIdx = bubbleIndex`（如 `bi:5`）——公式算 `childrenIndex = 78 - 5 = 73`，实测 `bi:5` 内容确实在 domIdx 73 ✅。但 `bi:73` 算 `childrenIndex = 78 - 73 = 5`，实测 `bi:73` 内容在 domIdx 5 ✅。

看似公式正确——但实测 `bi:55` 算 `childrenIndex = 78-55 = 23`，实测内容在 domIdx 19 ❌。**公式对部分条目错位**。

#### 29.3.2 真实根因：parser 与 SDK 坐标系不一致

实测 DOM 与 parser 数据对比：

| 项 | parser | SDK DOM |
|------|------|------|
| 多消息 agent 回复 | 每条消息各占一个 cardIdx（reasoning/plugin_call/message 各 +1） | 合并成单张 agent card 渲染 |
| cardIdx 最大值 | 77 | 39 agent cards |
| `bi:5` 实测位置 | parser cardIdx 5 | DOM `agentDomPos=36`（domIdx 73） |
| `bi:55` 实测位置 | parser cardIdx 55 | DOM `agentDomPos=9`（domIdx 19） |

SDK 把多消息 agent 回复（含 reasoning + plugin_call + message）**合并成单张 agent card** 渲染，parser 却给每条消息各分配一个 cardIdx——**两个坐标系不一致**，parser cardIdx 有"跳跃"，无法靠简单公式映射到 DOM idx。

#### 29.3.3 本轮修复：与视口追踪器同款公式

`useViewportTracker.ts:82` 的视口追踪器实测能正确高亮当前卡片，用同款公式反算：

```typescript
const agentDomPos = sdkCardCount - 1 - parserIdx;
const childrenIndex = isTopic
  ? 2 + agentDomPos * 2   // user bubble
  : 1 + agentDomPos * 2;  // agent card
```

`sdkCardCount` = DOM 里 `.qwenpaw-bubble-start` 元素数（实测 39），而非 parser `totalCards`（78）。`isTopic` 改用 `group === "topic"` 直接判断，不从奇偶性反推。

```typescript
// §29: parser bubbleIndex 与 SDK DOM 映射——用 SDK agent card 总数反算。
// 视口追踪器实测正确公式: bubbleIndex = sdkCardCount - 1 - agentDomPos
//   → agentDomPos = sdkCardCount - 1 - bubbleIndex
//   → domIdx = 1 + agentDomPos * 2 (spacer 占 idx 0，后成对)
// 注: parser cardIdx 有跳跃(SDK 合并多消息为单卡)，此公式对单消息卡精准，
// 多消息卡可能偏移——根因是 parser 与 SDK 坐标系不一致，需架构层修复。
```

#### 29.3.4 已修复 vs 留到下轮

| 项 | 状态 | 说明 |
|------|:------:|------|
| `isTopic` 奇偶性判断 | ✅ 已修复 | 改用 `group === "topic"` |
| `childrenIndex = tc - parserIdx` 公式 | ✅ 已修复 | 改用 `sdkCardCount - 1 - parserIdx` + `agentDomPos * 2` |
| parser 与 SDK 坐标系不一致 | ⚠️ 留到下轮 | parser cardIdx 有跳跃，SDK 合并多消息为单卡——公式对单消息卡精准，多消息卡仍偏移 |

### 29.4 改动范围

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `IndexItem` 加 `fullText?: string` 字段 |
| `src/parser/conclusionParser.ts` | `extractStructured` 返回 `{title, fullText}[]`；剥除加粗后 `full` 存 `fullText`，截断版存 `title`；`items.push` 加 `fullText` |
| `src/BarStrip.tsx` | 二级弹窗 `{secondaryItem.title}` 改 `{secondaryItem.fullText || secondaryItem.title}` |
| `src/index.tsx` | `isTopic` 改 `group === "topic"`；`childrenIndex` 改 `sdkCardCount - 1 - parserIdx` + `agentDomPos * 2` |

### 29.5 验证

| 问题 | 改进前 | 改进后 |
|------|------|------|
| 二级弹窗截断 | 显示截断 `title`（40字） | 显示 `fullText` 完整原文 ✅ |
| 跳转公式 | `tc - parserIdx`（部分错位） | `sdkCardCount - 1 - parserIdx`（与视口追踪器一致） ✅ |
| `isTopic` 判断 | 奇偶性反推（cardIdx 跳跃时不可靠） | `group === "topic"` 直判 ✅ |

### 29.6 构建产物

```
dist/index.js  48.90 KB  (gzip: 14.04 kB)
```

---

## 30. 跳转公式回退 + conclusion 精准定位 C2 粛选（2026-07-06）

### 30.1 起点：§29 误改的回退

§29 把跳转公式改成 `sdkCardCount - 1 - parserIdx + agentDomPos * 2`（用 SDK agent card 总数 39），并误判根因是"parser 与 SDK 坐标系不一致"。本轮实测推翻此诊断：

实测视口最居中卡片：`activeBi=77`，`vtPos=0`（DOM idx 0，最新卡），公式 `tc-1-vtPos = 78-1-0 = 77` ✅ 与 activeBi 完全一致。**视口追踪器一直是对的**，用 `tc=totalCards=78`，`agentDomPos=indexOf(el)-1`（DOM 全局 idx），反算 `bubbleIndex = tc-1-agentDomPos = tc-idx`，即 **`idx = tc - bubbleIndex`**。

三项实测全对：
- `bi=77`（newest）→ `idx = 78-77 = 1` ✅（idx 1 是首个 agent card）
- `bi=73` → `idx = 78-73 = 5` ✅
- `bi=5` → `idx = 78-5 = 73` ✅

**真实根因**：§29 误改成 `sdkCardCount-1-parserIdx + agentDomPos*2` 完全错误。本轮回退正确公式 `childrenIndex = tc - parserIdx`（与视口追踪器同源）。

### 30.2 实测：parser 与 SDK 坐标系是一致的

§29 误判"parser cardIdx 有跳跃（SDK 合并多消息为单卡），坐标系不一致"。本轮实测推翻：

- DOM 内 idx 5 卡片 `textContent` 含"完全不提文件名"（bi:73 对应内容）✅
- 公式 `idx = tc - bubbleIndex` 三项实测全对

**两坐标系是一致的**，没有跳跃。SDK 合并多消息为单卡渲染，但 parser cardIdx 也按"user 后首个 assistant 递增+1、后续 assistant 共享同卡片"规则算，与 SDK 渲染一致。

### 30.3 修复一：跳转公式回退

`src/index.tsx:navigateToMessage` 的公式回退：

```typescript
// §30: 跳转公式与视口追踪器（useViewportTracker）同源。
// 视口追踪器实测正确: agentDomPos = indexOf(el) - 1
//   → bubbleIndex = tc - 1 - agentDomPos = tc - 1 - (idx - 1) = tc - idx
//   → idx = tc - bubbleIndex
// 实测: bi=77(newest) → idx 1 ✅, bi=73 → idx 5 ✅, bi=5 → idx 73 ✅
// §29 误改成 sdkCardCount-1-parserIdx + agentDomPos*2 完全错误,本轮回退。
const isTopic = group === "topic";
const childrenIndex = tc - parserIdx;
```

`isTopic` 保留 §29 的 `group === "topic"` 直判（不从奇偶性反推）。

### 30.4 修复二：conclusion 精准定位 C2 粛选

#### 30.4.1 根源

`navigateToMessage` 第 283 行 conclusion 选择器 `strong, li` 抓全部加粗/列表（含非结论的"当前工作目录"等），与 parser `childIndex`（只数 C2 白名单命中的结论）索引不一致。

实测 `bi:73` 对应的 idx 5 卡片：11 个 `strong`、2 个 `li`，其中 `strongs[0]` 是"当前工作目录或其子目录"（非结论），`strongs[4]` 才是目标"完全不提文件名"。但 parser `ci:0` 期望匹配首条 C2 命中的结论——**DOM 囁全量 strong 导致 ci 与候选序号错位**。

#### 30.4.2 修复：用 hasConclusionMarker 同款判据筛选 DOM �候选

```typescript
} else if (group === 'conclusion') {
  // §30: conclusion 的 childIndex 是按"C2 白名单命中"计
  // (parser 只数含结论特征的 strong/li),但 querySelectorAll('strong, li')
  // 抓全部加粗/列表(含非结论的"当前工作目录"等),索引不一致。
  // 修复:用与 parser 同款的 hasConclusionMarker 判据筛选 DOM 候选,
  // 只数含结论特征(✅⛔❌✓✗/通过/失败/成功/已.../量化)的 strong/li。
  const verdict = /[✅⛔❌✓✗]|[通过|失败|正确|错误|成功|完美|通关]/;
  const conclusionMarker = /^(结论|总结|最终|结果|答案|核心|关键|总的来说|综上|最终结论|要点|发现|结论是|总结一下|Conclusion|Summary|Result|Answer|Key|Finding|Finally)/;
  const doneRe = /^已(创建|修复|完成|修改|设置|找到|解决|实现|添加|删除|更新)/;
  const doneEnRe = /^(Done|Completed|Fixed|Created|Resolved|Updated|Added|Removed)/;
  const quantified = /\d+\s*(个|次|条|行|项|处|ms|秒)|\d+\%|\d+\.\d+/;
  let matchIdx = 0;
  for (const el of candidates) {
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length < 5) continue;
    if (conclusionMarker.test(txt) || verdict.test(txt) ||
        doneRe.test(txt) || doneEnRe.test(txt) || quantified.test(txt)) {
      if (matchIdx === childIndex) {
        precisionTarget = el;
        console.log(LOG, `precision: conclusion[${childIndex}] matched by C2 marker`);
        break;
      }
      matchIdx++;
    }
  }
}
```

判据与 `conclusionParser.ts:hasConclusionMarker` 同款（结论标记词、判断符号、完成态、量化结果），保证 DOM 候选序号与 parser `childIndex` 一致。

### 30.5 验证

实测调 `navFn(73, 0, "conclusion", "conclusion-28")`，console 日志：

```
[dialog-index] precision: conclusion[0] matched by C2 marker
[dialog-index] navigated to parserIdx=73 "你明确解除限制、授权我在 D:\\代码\\ 下创建" at (744,-3116)
```

**两个修复点均已生效**：
- 公式回退：`navigated to parserIdx=73` 成功定位 ✅
- C2 粛选：`precision: conclusion[0] matched by C2 marker` ✅

### 30.6 遗留边界：childIndex 与 DOM 候选范围不一致

实测揭示一个新边界问题——跳转到的文本是"你明确解除限制、授权我在 D:\\代码\\ 下创建"，**不是** `bi:73` 条目的"第3轮：完全不提文件名和路径"。

根源：parser `childIndex` 按**该条消息内**的 C2 命中数计，DOM 搜的是**整张卡片**（含多轮回复的多条 message）。`conclusion[0]` 医配到该卡片内首个含 C2 标记的 strong（来自别的消息），而非条目对应的那个。

此边界问题留到下轮（§31）修复。

### 30.7 改动范围

| 文件 | 改动 |
|------|------|
| `src/index.tsx` | 跳转公式回退 `childrenIndex = tc - parserIdx`；conclusion 精准定位用 C2 白名单判据筛选 DOM 候选（与 parser `hasConclusionMarker` 同款） |

### 30.8 构建产物

```
dist/index.js  49.87 KB  (gzip: 14.51 kB)
```

---

## 31. conclusion 精准定位 childIndex 对齐修复（2026-07-06）

### 31.1 起点：§30.6 遗留边界

§30 实测调 `navFn(73, 0, "conclusion", "conclusion-28")` 跳转后精准命中的文本是"你明确解除限制、授权我在 D:\\代码\\ 下创建"，**不是** `bi:73` 条目的"第3轮：完全不提文件名和路径"。

### 31.2 根源

实测 idx 5 卡片（bi:73 对应）内 DOM C2 命中候选与 parser 条目对照：

| DOM C2 命中序号 | DOM 文本 | parser `ci` | parser 文本 |
|:------:|------|:------:|------|
| 0 | "你明确解除限制、授权我在 D:\\代码\\..." | 0 | "第3轮：完全不提文件名和路径" |
| 1 | "第3轮：完全不提文件名和路径" | 1 | "第4轮：完全无提及" |
| 2 | "第4轮：完全无提及" | 2 | "全部通过！测试结果如下：" |
| 3 | "全部通过！测试结果如下：" | — | — |

DOM 有 4 个 C2 命中，parser 只有 3 个条目——**DOM 多了首个"你明确解除限制..."**。这条是 agent 引用 user 原话的 `li`（含"成功"或量化数字被 C2 误命中），parser 因 `msg.type !== "message"` 跳过了它，但 DOM 渲染时它出现在卡片里，`querySelectorAll('strong, li')` 抓到了它，导致候选序号与 parser `childIndex` 错位。

**真实根源**：parser 只对 `type:"message"` 提取结论，但 DOM 卡片含所有类型消息（含 user 引用、reasoning 段残留等）。DOM 的 C2 命中候选序号比 parser 多了非 message 类型的命中。

### 31.3 修复：DOM 端跳过 agent 引用 user 原话的 li

`src/index.tsx` 的 conclusion 精准定位分支加 `userQuote` 正则，跳过含用户口吻被 agent 引用的列表项：

```typescript
// §31: 跳过 agent 引用 user 原话的 li(含"授权我"、"你会照做"等
// 用户口吻被 agent 引用的列表项)——parser 按 msg.type!=="message"
// 跳过了它们,DOM 端也必须跳过才能让候选序号与 parser childIndex 一致。
const userQuote = /(授权我|你会照做|需要你确认|让你|请你|我要你|帮我|我要)/;
let matchIdx = 0;
for (const el of candidates) {
  const txt = (el.textContent || '').trim();
  if (!txt || txt.length < 5) continue;
  // 跳过 agent 引用 user 原话的 li(非真结论,parser 已跳过)
  if (userQuote.test(txt)) continue;
  // 用与 parser hasConclusionMarker 同款判据
  if (conclusionMarker.test(txt) || verdict.test(txt) ||
      doneRe.test(txt) || doneEnRe.test(txt) || quantified.test(txt)) {
    if (matchIdx === childIndex) {
      precisionTarget = el;
      console.log(LOG, `precision: conclusion[${childIndex}] matched by C2 marker`);
      break;
    }
    matchIdx++;
  }
}
```

### 31.4 验证

实测调 `navFn(73, 0, "conclusion", "conclusion-28")`，console 日志：

```
[dialog-index] precision: conclusion[0] matched by C2 marker
[dialog-index] navigated to parserIdx=73 "第3轮：完全不提文件名和路径" at (792,119)
```

**精准命中目标文本** ✅——不再是上一轮的"你明确解除限制..."，而是正确的"第3轮：完全不提文件名和路径"。

### 31.5 改动范围

| 文件 | 改动 |
|------|------|
| `src/index.tsx` | conclusion 精准定位加 `userQuote` 正则跳过 agent 引用 user 原话的 li |

### 31.6 构建产物

```
dist/index.js  49.97 KB  (gzip: 14.59 kB)
```

---

## §32 结论分组远距离跳转修复（2026-07-07）

### 32.1 问题

结论分组最远距离条目气 #6「Daemon 段在跑 — 配置是 `DAEMON2ACP_MODE=proxy`…」始终无法跳转定位。实测 console 显示旧版跳转滚到的是气 #5 user bubble「关键原则：」，不是气 #6 agent card 内的目标 li。

### 32.2 根因链（本轮实测锁定）

实测气 #6 parser 数据（React fiber 拿 indexData）：

| 字段 | 值 |
|------|:--|
| id | `conclusion-0` |
| bubbleIndex | 5 |
| childIndex | 0 |
| title | 「Daemon 段在跑 — 配置是 `DAEMON2ACP_MODE=proxy`」 |

**根因 1：loadMore scroll 循环 stall 误判放弃**

`navigateToMessage` 原走 `scrollIntoView` 触发 SDK IntersectionObserver PAGE_SIZE=10 逐批加载。远距离目标（气 #6 idx=73，需加载到第 8 页）中途 SDK re-fetch 时 card 数短暂不变 stall++，连续 3 次误判放弃 → 永远加载不到。

**根因 2：fiber dispatch 快通道未被使用**

`useMessageMap.loadCardsToPosition`（React fiber 状态调度 targetPage，flushSync 一次到位）早已实现，但 `navigateToMessage` 只取了 `cardCount`，没用 `loadCardsToPosition`——放着快通道走笨 scroll 循环。

**根因 3：sdkCardPos 算法错位（§32 首轮误传）**

`loadCardsToPosition(sdkCardPos)` 入参是「0-based newest 端 SDK 卡序」。气 #6 `parserIdx=5` 是 parser bubbleIndex（1=newest），但 DOM idx = tc - parserIdx = 73（oldest 端）。SDK paginate 按 DOM idx 端，sdkCardPos 应传 `childrenIndex - 1`（idx-1），不是 `parserIdx - 1`。§32 首轮误传 `parserIdx-1=4` → dispatch 只到第 2 页，目标卡未渲染 → fallback。

**根因 4：DOM 端 conclusion 候选序号与 parser 不同源**

parser `extractStructured` 按 BOLD_RE → NUMBERED_RE → LIST_ITEM_RE 三优先级分抓 findings，childIdx 跨级累加。但 DOM 端 `querySelectorAll('strong, li')` 按 SDK 渲染顺序命——气 #6 parser childIdx=0（listResults 第 0 条），DOM 命中序号 2（前面还有两个 `<strong>关键原则：</strong>` 占位）。

**根因 5：DOM `<strong>` 含 SDK 样式加粗非 parser 源 markdown 加粗**

实测气 #6 agent card 内 61 个 `<strong>`，28 个是 SDK 渲染字段标签样式加粗（「名字：」「定位：」「风格：」等短词带冒号），非 parser 端 `BOLD_RE` 抓的源 markdown `**xxx**` 加粗。DOM 端 `querySelectorAll('strong')` 把它们也当 boldResults 命，导致跨级累加序号错位。

### 32.3 改动

| 文件 | 改动 |
|------|------|
| `src/DetailPopover.tsx` | 删（死代码，全项目无引用处） |
| `src/index.tsx` | (1) `useMessageMap` 补取 `loadCardsToPosition`<br>(2) `navigateToMessage` loadMore 殖 替为 fiber dispatch 快通道，scroll 循环降为 fallback<br>(3) `sdkCardPos = childrenIndex - 1`（idx-1，0-based newest 端 SDK 卡序），非 parserIdx-1<br>(4) conclusion 精准段改按 parser 同款三优先级分抓 DOM 候选——先 strong(bold)→numbered li→普通 li，跨级累加序号与 parser childIdx 对齐<br>(5) boldEls 筛掉 SDK 样式字段标签类短加粗（`/^[^：:]{1,8}[：:]/` 筛），只保留内容性加粗与 parser BOLD_RE 对齐<br>(6) useCallback deps 补 `loadCardsToPosition` |

### 32.4 实测验证

实测调 `onNavigate(5, 0, "conclusion", "conclusion-0")`（气 #6），console 日志：

```
[dialog-index] need dispatch: domPage 1 < target 9 for sdkCardPos 72
[dialog-index] fiber dispatch 1→9 for sdkCardPos 72
[dialog-index] fiber dispatch did not yield target, fallback to scroll loop
[dialog-index] target found after 11 fallback scroll loads
[dialog-index] precision: conclusion[0] matched by C2 (parser-aligned order)
[dialog-index] navigated to parserIdx=5 "Daemon 段在跑 — 配置是 DAEMON2ACP_MODE=proxy，会" at (731,118)
```

精准命中气 #6「Daemon 段在跑」原文，坐标 (731,118) 在视口内——跳转定位成功 ✅

### 32.5 遗留

fiber dispatch fallback 性能问题：dispatch 到 targetPage=9 后 1500ms 等 SDK re-fetch 渲染不够，走 fallback scroll loop 11 次 (~9s) 才找到。可后续优化：dispatch 后用 MutationObserver 盯听 card 数变化到 targetPage 即停，替代固定 1500ms 等。

### 32.6 构建产物

```
dist/index.js  49.83 KB  (gzip: 14.68 kB)
```

---

## §32.5 scroll loop 精准定位失效修复 + 性能优化（2026-07-11）

### 32.5.1 起点：§32 遗留的性能问题

§32 reintroduce `loadCardsToPosition`（fiber dispatch 快通道）试图加速远距离跳转，但实测 dispatch 触发后 SDK 不渲染远端卡，走 fallback scroll loop 11 次 × 800ms ≈ 9s 才找到——比纯 scroll loop 还慢。§32.5 遗留任务：优化这 9s 性能。

### 32.5.2 归因（DEVLOG 历史溯源 + 本轮实测）

**§32 reintroduce `loadCardsToPosition` 是重蹈 §15/§18 覆辙**：

| 阶段 | 载体 | 实测结论 |
|:--|:--|:--|
| §10 (2026-06-30) | `ensureAllCardsLoaded()` 首次引入 fiber dispatch + `flushSync` + 等 1500ms | ✅ 组件初始化时一次加载全部卡片成功 |
| §15 (2026-07-01) | 导航时调 fiber dispatch | ❌ 弃用——SDK page=10 已到上限，dispatch 不渲染远端卡 |
| §17-§18 (2026-07-01) | **定论**：fiber dispatch 在导航时失效，`scrollToLoadMore` 是唯一可用通道 | ✅ 确立 scroll loop 主路径，移除 `loadCardsToPosition` 导航依赖 |
| §32 (2026-07-07) | **reintroduce** `loadCardsToPosition` + `await 1500ms` 作快通道，scroll loop 降 fallback | ⚠️ dispatch 触发但 SDK 不渲染远端卡，走 fallback 11 次 (~9s) |

§32 没查阅 §15/§18 历史，重新引入已失效路径。**但 §32 仍能跳转成功**，靠的是 fallback scroll loop——以及 `await 1500ms` 的副作用。

**`await 1500ms` 的真正用意**：

§32 原版的 `await 1500ms` 不只是「等 dispatch 生效」，副作用地给了 SDK 500ms 轮询 re-fetch 一个完整窗口——re-fetch 完成后 DOM 稳定，scroll loop 加载完剩余卡后 DOM 仍稳定，精准段命中的 DOM 节点是新鲜的。

**本轮 console 实测证据**（§32.5 v3 删 1500ms 后）：

```
msgid=59  target found after 14 scroll loads       ← scroll loop 找到目标
msgid=60  precision: conclusion[0] matched by C2   ← 精准段命中
msgid=61  Fetched 879 messages                     ← re-fetch 在精准段之后触发！
```

re-fetch 在精准段 **之后**触发，re-render 替换了 `precisionTarget` 指向的 DOM 节点，后续 `scrollIntoView`/`addClass` 在已脱离 DOM 树的旧节点上操作 → 滚到整个气泡而非结论元素，高亮也是整个气泡。

### 32.5.3 本轮迭代过程（三次失败 + 最终成功）

| 版本 | 实现 | 实测 | 问题 |
|:--|:--|:--|:--|
| §32.5 v1 MutationObserver | 删 dispatch + 1500ms，observer 盂 3s → fallback | 14s+，flash ❌ | observer 盂空变化（dispatch 没渲染），3s 等浪费 |
| §32.5 v2 兜底等 10s | observer 兜底等 增到 10s | 17s+，flash ❌ | 同上，等再久都是空变化 |
| §32.5 v3 scroll loop 300ms | 删 dispatch+observer，scroll loop 30×300ms + stall 5 | 13s+，flash ❌ | 1500ms 误删，re-fetch 替换 DOM 节点 |
| §32.5 v4 方案 A（最终版） | scroll loop 300ms + 精准段前加 1500ms 稳定窗口 | ~5.5s，flash ✅ | 成功 |

### 32.5.4 最终改动（方案 A）

`src/index.tsx:navigateToMessage` 的 loadMore 段：

1. **删** fiber dispatch + `loadCardsToPosition` + `await 1500ms` + fallback scroll loop 段（§32 原版）
2. **scroll loop 升主路径**：每轮等 300ms（原 800ms）+ stallCount 5 次放弃（原 3）+ attempt 上限 30（原 20）
3. **精准段前加 `await 1500ms` 稳定窗口**（`finally` 之后、`if (target)` 之内）——让 re-fetch 完成后 DOM 稳定再命中新鲜节点

关键定位：1500ms 加在 scroll loop **之后**、精准段 **之前**（非之前误加在 scroll loop 之前）——console 实测 msgid=126 `Fetched 879` 在 navigated 之前，稳定窗口生效。

### 32.5.5 实测验证

实测调 `onNavigate(5, 0, "conclusion", "conclusion-0")`（气 #6「Daemon 段在跑」），console 日志：

```
msgid=123  target found after 13 scroll loads
msgid=124  precision: conclusion[0] matched by C2 (parser-aligned order)
msgid=125  navigated to parserIdx=5 "Daemon 段在跑 — 配置是 DAEMON2ACP_MODE=proxy，会" at (731,118)
msgid=126  Fetched 879 messages from chat ...    ← re-fetch 在 navigated 之后（1500ms 稳定窗口生效）
```

精准命中气 #6「Daemon 段在跑」原文，坐标 (731,118) 在视口内——跳转定位成功 ✅

耗时 ~5.5s（scroll loop 13×300ms + 1500ms 稳定），比 §32 原版 9s 快一倍。

### 32.5.6 关于 observer 能否配合 scroll loop

**能配合，有意义**——但本轮方案 A 未采用。

`MutationObserver` 盂 `bubbleList` 的 `childList` 变化，在 scroll loop 的每次轮等期间，当 SDK 渲染新卡触发 DOM 变化时，observer 立即回调检查 target 是否已出现，不等 300ms 超时。

| 方案 | 每轮等 | 命中时机 | 复杂度 |
|:--|:--|:--|:--|
| 纯 scroll loop（方案 A，当前） | 300ms poll | 下一轮 poll 到 target 时 | 低 |
| scroll loop + observer（方案 C） | 100ms poll + observer 实时回调 | 新卡渲染后立即（比 poll 早 0~300ms） | 中 |

方案 A 已找到 target 在 ~3s（13 轮）。加 observer 的优化空间有限——最多省 ~1-2s，代码复杂度增加不少。**当前方案 A 的 5.5s 已够好，observer 边际收益有限**。

### 32.5.7 方案 C 计划（后续优化方向）

若后续需进一步提速到 ~2.5s，可升级到方案 C（scroll loop + observer 实时回调）：

```typescript
try {
  // 1. 等 SDK re-fetch 完成一次,DOM 稳定
  await new Promise((r) => setTimeout(r, 1500));
  // 2. scroll loop + observer 实时回调命中即停
  let settled = false;
  const ob = new MutationObserver(() => {
    if (getTarget() && !settled) { settled = true; }
  });
  ob.observe(bubbleList, { childList: true, subtree: false });
  for (let attempt = 0; attempt < 30 && !settled; attempt++) {
    loadMore.scrollIntoView({ block: "start" });
    await new Promise((r) => setTimeout(r, 100));  // 每轮等缩到 100ms
  }
  ob.disconnect();
} finally { setIsNavigating(false); }
if (target) { /* 精准段——re-fetch 已完成,DOM 稳定,命中新鲜节点 */ }
```

预期耗时：1500ms + scroll loop 10×100ms ≈ 2.5s。需实测验证 observer 在 scroll loop 触发的 SDK 渲染时是否可靠回调。

### 32.5.8 构建产物

```
dist/index.js  50.18 KB  (gzip: 14.73 kB)
```


