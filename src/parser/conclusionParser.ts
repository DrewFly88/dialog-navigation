import { QPMessage, IndexItem } from "../types";
import { getPlainText } from "./topicExtractor";

const BOLD_RE = /\*\*(.+?)\*\*/g;
const LIST_ITEM_RE = /^[\s]*[-*]\s+(.+)$/gm;
const NUMBERED_RE = /^[\s]*\d+[.)]\s+(.+)$/gm;

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
        const title =
          finding.length > 40 ? finding.slice(0, 40) + "..." : finding;

        items.push({
          id: "conclusion-" + items.length,
          group: "conclusion",
          title,
          bubbleIndex: cardIdx,
          timestamp: "",
        });
      }
    }
  }

  // Deduplicate by title within same bubbleIndex
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.bubbleIndex + ":" + item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractStructured(text: string): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;

  // Extract bold text (key conclusions)
  BOLD_RE.lastIndex = 0;
  while ((match = BOLD_RE.exec(text)) !== null) {
    const bold = match[1].trim();
    if (bold.length > 5 && bold.length < 100) {
      results.push(bold);
    }
  }

  // Extract list items
  LIST_ITEM_RE.lastIndex = 0;
  while ((match = LIST_ITEM_RE.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 5 && item.length < 120) {
      results.push(item);
    }
  }

  // Extract numbered items
  NUMBERED_RE.lastIndex = 0;
  while ((match = NUMBERED_RE.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 5 && item.length < 120) {
      results.push(item);
    }
  }

  return results;
}
