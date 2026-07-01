# dialog-index-plugin 功能设计：视口高亮与点击跳转

> 版本: v0.3.0 | 日期: 2026-06-30

---

## 1. 现状分析

### 1.1 已有代码框架

视口高亮和点击跳转的代码框架已存在于 v0.2.0 中：

- `useViewportTracker.ts` — 滚动时检测当前可见消息，返回 `activeMsgIndex`
- `navigateToMessage()` — 在 `index.tsx` 中，接收 `msgIndex`，查找 `[data-dip-msg-index="N"]` 后 `scrollIntoView`
- `BarStrip.tsx` — 渲染索引行，使用 `item.msgIndex === activeMsgIndex` 判断高亮，点击调用 `onNavigate(msgIndex)`
- `useMessageMap.ts` — MutationObserver 监听 DOM，为消息元素打上 `data-dip-msg-index` 标签

### 1.2 功能失效根因

**DOM 选择器错误**：`useMessageMap` 用 `[class*='message']` 查找消息元素，但 QwenPaw 实际 DOM 中：

- 消息气泡 class 为 `qwenpaw-bubble-start`（助手）和 `qwenpaw-bubble-end`（用户），不含 "message"
- `[class*='message']` 匹配到的是包裹层 `qwenpaw-chat-anywhere-message-list`（单个元素）
- 导致标签打在了错误的元素上

**API 与 DOM 的消息结构不对齐**：

| 维度 | API (`GET /chats/:id`) | DOM（气泡列表） |
|------|----------------------|----------------|
| 用户消息 | 每条 user 消息一个 Message 对象 | 一个 `bubble-end` 元素 |
| 助手消息 | 每条 assistant/tool/system 消息各一个 Message 对象 | 多条连续 assistant 消息合并为一个 `bubble-start` 元素 |
| 消息 ID | `uuid4().hex`（32 位无横线 UUID） | user 保留 API ID；assistant 使用 `generateId()`（时间戳-随机串） |
| 计数 | N 条扁平消息 | 约 N/2 个气泡（用户数 + 对话轮次数） |

因此，按 API 消息数组序号（msgIndex）与按 DOM 气泡序号打标签，**两者天然不对齐**。

### 1.3 QwenPaw 可行性确认

- 聊天消息列表**不是虚拟列表**，所有消息均在 DOM 中
- 气泡元素支持标准 `scrollIntoView()` 和 `IntersectionObserver`
- QwenPaw **未提供官方滚动 API**（`window.QwenPaw.host` 和 `chat` 均无滚动方法）
- 通过 DOM 操作完全可行

---

## 2. 方案设计

### 2.1 核心思路：对话轮次（Turn Index）对齐

**关键观察**：API 中每条 user 消息对应 DOM 中一个 user 气泡（`bubble-end`），一条 user 消息与其后续所有连续 assistant 消息组成一个"对话轮次"。一轮对话对应一个 user 气泡 + 一个 assistant 气泡。

**方案**：使用"对话轮次索引"（turnIndex）作为 API 数据和 DOM 元素的统一编号：

```
API messages:
  [0] user     ─┐
  [1] assistant │ turn 0
  [2] assistant ─┘
  [3] user     ─┐
  [4] assistant │ turn 1
  [5] tool      ─┘
  [6] user     ─┐
  [7] assistant │ turn 2
                ─┘

DOM bubbles:
  [0] bubble-end (user)      → turn 0
  [1] bubble-start (assistant) → turn 0
  [2] bubble-end (user)      → turn 1
  [3] bubble-start (assistant) → turn 1
  [4] bubble-end (user)      → turn 2
  [5] bubble-start (assistant) → turn 2
```

**编号规则**：

- parser：遇到 user 消息时递增 turnIndex，该 user 及其后续所有非 user 消息使用同一 turnIndex
- DOM tagger：分别为 user 气泡和 assistant 气泡打 `data-dip-turn` 属性，值均为轮次序号
- 导航时查找 `[data-dip-turn="<turnIndex>"]` 的第一个元素（user 气泡），scrollIntoView 后目标 assistant 内容也在视口内

### 2.2 修改文件清单

| 文件 | 变更 |
|------|------|
| `src/hooks/useMessageMap.ts` | DOM 选择器改为 `bubble-start`/`bubble-end`；打标签改为 `data-dip-turn`（轮次编号） |
| `src/hooks/useViewportTracker.ts` | 查询 `[data-dip-turn]` 元素；返回当前可见的 turnIndex |
| `src/parser/*.ts` | msgIndex 改为 turnIndex（对话轮次编号） |
| `src/BarStrip.tsx` | 高亮逻辑从精确匹配改为"最近索引项"（≤ activeTurnIndex 的最大值）；点击传递 turnIndex |
| `src/index.tsx` | `navigateToMessage` 改用 `data-dip-turn` 查找元素 |
| `src/types.ts` | `IndexItem.msgIndex` 重命名为 `IndexItem.turnIndex`，语义不变 |
| `src/styles.css` | 修复 highlight flash 动画时间；添加 scroll-margin-top |

### 2.3 高亮逻辑优化

**现状**：`item.msgIndex === activeMsgIndex` 精确匹配，要求索引项的 msgIndex 恰好等于当前可见消息的序号。

**问题**：turnIndex 是"对话轮次"序号，而索引项只记录包含该类型内容的轮次。例如 turn 2 有代码块，但 turn 0 和 turn 1 没有，则代码分组只有 turnIndex=2。如果用户在 turn 1 和 turn 2 之间滚动，没有精确匹配。

**改进**：改为"最近索引项"逻辑——在当前分组的所有索引项中，找 `turnIndex ≤ activeTurnIndex` 的最大值。这样高亮的是"用户最近读过/正在读的最后一个索引项"。

```typescript
// BarStrip.tsx
const activeItem = currentItems.reduce((best, item) => {
  if (item.turnIndex <= activeTurnIndex && item.turnIndex > (best?.turnIndex ?? -1)) {
    return item;
  }
  return best;
}, null as IndexItem | null);
```

### 2.4 滚动偏移与动画

**scroll-margin-top**：scrollIntoView 后目标元素紧贴容器顶部，可能被 QwenPaw 顶栏遮挡。添加 CSS：
```css
[data-dip-turn] { scroll-margin-top: 60px; }
```

**highlight flash 时间对齐**：CSS 动画 4s，setTimeout 移除 class 2s → 统一为 2s。

---

## 3. 实施步骤

### 第一步：最小修复（修正 DOM 选择器 + turnIndex）

1. 修改 `useMessageMap.ts` — 选择器改为 `bubble-start`/`bubble-end`，标签改为 `data-dip-turn`
2. 修改 parser 各模块 — msgIndex 改为 turnIndex（轮次编号）
3. 修改 `useViewportTracker.ts` — 查询 `data-dip-turn`
4. 修改 `index.tsx` — navigateToMessage 改用 `data-dip-turn`
5. 修改 `BarStrip.tsx` — 高亮改为最近索引项
6. 修改 `types.ts` — msgIndex → turnIndex
7. 修改 `styles.css` — 动画时间对齐 + scroll-margin-top

### 验证

构建部署后在 QwenPaw 中验证：
- 悬停 BarStrip 展开索引列表，滚动聊天区，观察当前话题是否高亮
- 点击索引项，聊天区是否滚动到对应位置并闪烁高亮
- 切换不同 Agent、不同 session，功能是否正常

---

## 4. 未来增强

- **内容匹配定位**：对于长对话中同一轮次包含多个代码块的情况，使用文本内容匹配精确定位到具体代码块
- **IntersectionObserver 替代 scroll 事件**：更精确的可见性检测，支持多元素同时可见
- **消息 ID 直连**（仅 topic 分组）：topic 来自 user 消息，API ID 与 DOM data-msg-id 一致，可用 ID 直接导航
