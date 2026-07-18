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
  let prevCardIdx = -1;
  let childIdx = 0;
  // Track seen call_ids to deduplicate
  const seenCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "user") {
      if (!prevWasUser) cardIdx++;
      prevWasUser = true;
    } else {
      if (prevWasUser) {
        cardIdx++;
        childIdx = 0;  // Reset child index for new card
        prevCardIdx = cardIdx;
      }
      prevWasUser = false;

      if (Array.isArray(msg.content)) {
        const blocks = msg.content as any[];

        for (const block of blocks) {
          if (block.type === "text") continue;

          let toolName = "";
          let toolSummary = "";

          if (block.type === "data" && block.data) {
            // QwenPaw data blocks: data is an object with name/arguments
            const info = typeof block.data === "string" ? (() => { try { return JSON.parse(block.data); } catch { return null; } })() : block.data;
            if (info) {
              toolName = info.name || "";
              const args = info.arguments || info.input || {};
              if (typeof args === "object") {
                const keys = Object.keys(args);
                if (keys.length > 0) {
                  const val = args[keys[0]];
                  toolSummary = typeof val === "string" ? smartTruncate(val, 15) : keys[0];
                }
              }
              // Deduplicate by call_id (stream deltas duplicate the same call)
              const callId = info.call_id;
              if (callId) {
                if (seenCallIds.has(callId)) continue;
                seenCallIds.add(callId);
              }
            }
          } else if (block.type === "file") {
            toolName = "read_file";
            toolSummary = block.filename
              ? block.filename.replace(/\\/g, "/").split("/").pop() || ""
              : "";
          } else if (block.name) {
            // Standard format: tool_use / tool_call
            toolName = block.name;
            if (block.input) {
              const keys = Object.keys(block.input);
              if (keys.length > 0) {
                const val = block.input[keys[0]];
                toolSummary = typeof val === "string" ? smartTruncate(val, 15) : keys[0];
              }
            }
          }

          if (toolName) {
            const title = toolSummary ? toolName + " → " + toolSummary : toolName;
            items.push({
              id: "tool-" + cardIdx + "-" + childIdx,
              group: "tool",
              title: smartTruncate(title, 35),
              bubbleIndex: cardIdx,
              childIndex: childIdx++,
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
