# dialog-index-plugin 开发日志

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

