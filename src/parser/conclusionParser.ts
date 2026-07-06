import { QPMessage, IndexItem } from "../types";
import { smartTruncate } from "./utils";

const BOLD_RE = /\*\*(.+?)\*\*/g;
const LIST_ITEM_RE = /^[\s]*[-*]\s+(.+)$/gm;
const NUMBERED_RE = /^[\s]*\d+[.)]\s+(.+)$/gm;

/**
 * Simple Levenshtein distance (capped at maxDist for speed).
 */
function editDistance(a: string, b: string, maxDist = 5): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (i - j > maxDist && j - i > maxDist) {
        dp[i][j] = maxDist + 1;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
  }
  return dp[m][n];
}

// ── C2: 结论特征正向匹配 ──────────────────────────────────────────
// 真正的结论有可识别的语言模式：结论标记词、判断句、完成态表述、量化结果。
// 命中任一特征 → 高置信度结论；无命中不产生条目（纯白名单策略）。

// 结论标记词开头
const CONCLUSION_MARKER_RE = /^(结论|总结|最终|结果|答案|核心|关键|总的来说|综上|最终结论|要点|发现|结论是|总结一下)/;
const CONCLUSION_MARKER_EN_RE = /^(Conclusion|Summary|Result|Answer|Key|Finding|Finally|In summary|To summarize|Overall|The result)/;
// 判断/状态符号 — 只保留强判断词与符号，去掉"创建/修复/完成/解决"等中性动词，
// 否则"创建 session"、"第一轮：创建文件"等步骤标题会被误判为结论。
const VERDICT_RE = /[✅⛔❌✓✗]|[通过|失败|正确|错误|成功|完美|通关]/;
// 完成态表述 — 保留"已..."开头（完成态过去式），仍是结论特征
const DONE_RE = /^已(创建|修复|完成|修改|设置|找到|解决|实现|添加|删除|更新)/;
const DONE_EN_RE = /^(Done|Completed|Fixed|Created|Resolved|Updated|Added|Removed)/;
// 量化结果（"找到 29 个"、"耗时 3.2s"）
const QUANTIFIED_RE = /\d+\s*(个|次|条|行|项|处|ms|秒|s\b)|\d+\%|\d+\.\d+/;

/**
 * 判断一段文本是否含结论特征（正向高置信度匹配）。
 */
function hasConclusionMarker(text: string): boolean {
  const trimmed = text.trim();
  if (CONCLUSION_MARKER_RE.test(trimmed) || CONCLUSION_MARKER_EN_RE.test(trimmed)) return true;
  if (VERDICT_RE.test(trimmed)) return true;
  if (DONE_RE.test(trimmed) || DONE_EN_RE.test(trimmed)) return true;
  if (QUANTIFIED_RE.test(trimmed)) return true;
  return false;
}

/**
 * Check if text looks like a step/navigation instruction (not a conclusion).
 */
function isNoise(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5) return true;
  // Pure numbers or single characters
  if (/^[\d\s,.%]+$/.test(trimmed)) return true;
  // Step indicators
  if (/^(步骤|方法|方案|方式|途径|选项)\s*\d*$/.test(trimmed)) return true;
  // "Step X" / "步骤 X" patterns
  if (/^(Step\s+\d|步骤\s*\d)/i.test(trimmed)) return true;
  // 路径/文件名片段（非结论）
  if (/^[/\\.]|[a-zA-Z]:[\\/]/.test(trimmed) && trimmed.length < 60) return true;
  // 代码片段特征：反引号包裹、命令行开关、纯标识符（含下划线但无空格/标点）
  if (/^`[^`]+`$/.test(trimmed)) return true;  // `python` 单独成段
  if (/^[\w_]+ ← /.test(trimmed)) return true;  // `python` ← the command
  // 单个标识符（如 claude_code、opencode、args 多余引号）：无空格或仅一个短语
  if (trimmed.length < 25 && /^[\w_↓]+$/.test(trimmed)) return true;
  // 短加粗且纯标识符（无空格/标点）：通常只是强调词名，非结论
  if (trimmed.length < 12 && /^[^\s，。；！？,.!?;:]+$/.test(trimmed) && !VERDICT_RE.test(trimmed)) return true;
  return false;
}

// ── Thinking 段过滤：靠顶层 type 字段，零启发式 ──────────────────
// 后端用 agentscope MessageType 区分消息：
//   "reasoning" → Thinking 推理段（非用户可见回复）
//   "message"   → 真回复段（assistant 给用户的实际回答）
//   "plugin_call" → 工具调用（content 为 data block，无文本）
// 落盘后顶层 type 字段完整保留，历史 API 数据里一直就有此字段。
// 之前误诊"API 层无法区分"（DEVLOG §23.5）是因为只看了 block.type（全 "text"），
// 漏看了顶层 msg.type。见 DEVLOG §27.8 完整发现链。

export function extractConclusions(messages: QPMessage[]): IndexItem[] {
  const items: IndexItem[] = [];

  // cardIdx 与 SDK 渲染卡片对齐：user 后的连续 assistant 段共享一个卡片
  let cardIdx = 0;
  let prevWasUser = true;
  let childIdx = 0;

  for (const msg of messages) {
    if (msg.role === "user") {
      if (!prevWasUser) cardIdx++;
      prevWasUser = true;
      continue;
    }

    // assistant 消息
    if (prevWasUser) {
      cardIdx++;
      childIdx = 0;
    }
    prevWasUser = false;

    // 关键过滤：只对 "message" 类型提取结论。
    // 跳过 "reasoning"（Thinking 推理段）和 "plugin_call"（工具调用，无文本）。
    // cardIdx 已在上面递增完毕，跳过此处不会导致后续卡片错位。
    if (msg.type !== "message") continue;

    const text = Array.isArray(msg.content)
      ? (msg.content as { type: string; text?: string }[])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text || "")
          .join("")
      : (typeof msg.content === "string" ? msg.content : "");

    if (text.trim().length === 0) continue;

    // C2 纯白名单：只提取含结论特征的高置信度命中
    const findings = extractStructured(text, true);
    for (const finding of findings) {
      items.push({
        id: "conclusion-" + items.length,
        group: "conclusion",
        title: finding.title,
        fullText: finding.fullText,
        bubbleIndex: cardIdx,
        childIndex: childIdx++,
        timestamp: "",
      });
    }
  }

  // De-duplicate with fuzzy matching (edit distance < 5)
  const seen: string[] = [];
  return items.filter((item) => {
    if (isNoise(item.title)) return false;
    for (const existing of seen) {
      if (editDistance(item.title, existing) < 5) return false;
    }
    seen.push(item.title);
    return true;
  });
}

/**
 * 从一段文本提取结构化结论。
 * @param text 待提取文本
 * @param highConfidenceOnly 若 true，只返回含结论特征（C2）的命中；若 false，返回所有加粗/列表/编号命中
 * @returns {title: 截断标题, fullText: 完整原文（仅剥除加粗标记）}
 */
function extractStructured(text: string, highConfidenceOnly: boolean): { title: string; fullText: string }[] {
  // Priority 1: bold text (most likely real conclusions)
  const boldResults: string[] = [];
  let match: RegExpExecArray | null;
  BOLD_RE.lastIndex = 0;
  while ((match = BOLD_RE.exec(text)) !== null) {
    const bold = match[1].trim();
    if (bold.length > 5 && bold.length < 120) {
      if (!highConfidenceOnly || hasConclusionMarker(bold)) {
        boldResults.push(bold);
      }
    }
  }

  // Priority 2: numbered items
  const numberedResults: string[] = [];
  NUMBERED_RE.lastIndex = 0;
  while ((match = NUMBERED_RE.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 5 && item.length < 120) {
      if (!highConfidenceOnly || hasConclusionMarker(item)) {
        numberedResults.push(item);
      }
    }
  }

  // Priority 3: list items (lowest confidence)
  const listResults: string[] = [];
  LIST_ITEM_RE.lastIndex = 0;
  while ((match = LIST_ITEM_RE.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 5 && item.length < 120) {
      if (!highConfidenceOnly || hasConclusionMarker(item)) {
        listResults.push(item);
      }
    }
  }

  // Return in priority order: bold first, then numbered, then list.
  // Strip any residual bold markers (**x**) from list/numbered item content
  // so the title stays clean (bold match already strips them via capture group).
  // title = 截断版（一级浮层用）; fullText = 剥除加粗后的完整原文（二级弹窗用）.
  const all = [...boldResults, ...numberedResults, ...listResults];
  return all.map((f) => {
    const full = f.replace(/\*\*(.+?)\*\*/g, "$1");
    return { title: smartTruncate(full, 40), fullText: full };
  });
}
