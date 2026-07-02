import { QPMessage, IndexItem } from "../types";
import { getPlainText } from "./topicExtractor";
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
  return false;
}

export function extractConclusions(messages: QPMessage[]): IndexItem[] {
  const items: IndexItem[] = [];
  let cardIdx = 0;
  let prevWasUser = true;

  for (const msg of messages) {
    if (msg.role === "user") {
      if (!prevWasUser) cardIdx++;
      prevWasUser = true;
    } else {
      if (prevWasUser) cardIdx++;
      prevWasUser = false;

      const text = getPlainText(msg.content);
      const findings = extractStructured(text);

      for (const finding of findings) {
        items.push({
          id: "conclusion-" + items.length,
          group: "conclusion",
          title: finding,
          bubbleIndex: cardIdx,
          timestamp: "",
        });
      }
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

function extractStructured(text: string): string[] {
  // Priority 1: bold text (most likely real conclusions)
  const boldResults: string[] = [];
  let match: RegExpExecArray | null;
  BOLD_RE.lastIndex = 0;
  while ((match = BOLD_RE.exec(text)) !== null) {
    const bold = match[1].trim();
    if (bold.length > 5 && bold.length < 120) {
      boldResults.push(bold);
    }
  }

  // Priority 2: numbered items
  const numberedResults: string[] = [];
  NUMBERED_RE.lastIndex = 0;
  while ((match = NUMBERED_RE.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 5 && item.length < 120) {
      numberedResults.push(item);
    }
  }

  // Priority 3: list items (lowest confidence)
  const listResults: string[] = [];
  LIST_ITEM_RE.lastIndex = 0;
  while ((match = LIST_ITEM_RE.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 5 && item.length < 120) {
      listResults.push(item);
    }
  }

  // Return in priority order: bold first, then numbered, then list
  const all = [...boldResults, ...numberedResults, ...listResults];
  // Apply smart truncation to each
  return all.map((f) => smartTruncate(f, 40));
}
