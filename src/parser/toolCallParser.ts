import { QPMessage, QPContentBlock, IndexItem } from "../types";
import { smartTruncate } from "./utils";

/**
 * Summarize tool input for a readable title.
 * - String values: show shortened content
 * - File paths: extract just the filename
 * - Objects: show first key name
 */
function summarizeInput(input?: Record<string, unknown>): string {
  if (!input) return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  const firstKey = keys[0];
  const val = input[firstKey];

  // File path → just the filename
  if (typeof val === "string" && firstKey.toLowerCase().includes("path")) {
    const parts = val.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || firstKey;
  }

  // String value → shorten
  if (typeof val === "string") {
    return smartTruncate(val, 15);
  }

  // Object/array → key name
  return firstKey;
}

export function extractToolCalls(messages: QPMessage[]): IndexItem[] {
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

      if (Array.isArray(msg.content)) {
        const blocks = msg.content as QPContentBlock[];

        // First pass: tool_use blocks
        for (const block of blocks) {
          if (block.type === "tool_use" && block.name) {
            const inputSummary = summarizeInput(block.input);
            const title = inputSummary
              ? block.name + " → " + inputSummary
              : block.name;

            items.push({
              id: "tool-" + items.length,
              group: "tool",
              title: smartTruncate(title, 35),
              bubbleIndex: cardIdx,
              timestamp: "",
              status: "success",
            });
          }
        }

        // Second pass: tool_result → check for errors & override title
        for (const block of blocks) {
          if (block.type === "tool_result") {
            const lastTool = items[items.length - 1];
            if (lastTool && lastTool.group === "tool") {
              const resultContent =
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);

              if (
                resultContent &&
                (resultContent.includes("error") ||
                  resultContent.includes("Error") ||
                  resultContent.includes("failed") ||
                  resultContent.includes("Failed"))
              ) {
                lastTool.status = "fail";
                // Try to extract a meaningful error snippet for the title
                const errorMatch = resultContent.match(
                  /(?:error|Error|failed|Failed)[:\s]+([^.\n]{1,40})/i
                );
                if (errorMatch) {
                  lastTool.title = "⚠ " + smartTruncate(errorMatch[1].trim(), 30);
                }
              }
            }
          }
        }
      }
    }
  }

  return items;
}
