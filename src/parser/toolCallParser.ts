import { QPMessage, QPContentBlock, IndexItem } from "../types";

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
        for (const block of msg.content as QPContentBlock[]) {
          if (block.type === "tool_use" && block.name) {
            const inputSummary = summarizeInput(block.input);
            const title = inputSummary
              ? block.name + "(" + inputSummary + ")"
              : block.name;

            items.push({
              id: "tool-" + items.length,
              group: "tool",
              title: title.length > 35 ? title.slice(0, 35) + "..." : title,
              bubbleIndex: cardIdx,
              timestamp: "",
              status: "success",
            });
          }
        }

        // Check for tool_result errors in the same message
        for (const block of msg.content as QPContentBlock[]) {
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
                  resultContent.includes("Error"))
              ) {
                lastTool.status = "fail";
              }
            }
          }
        }
      }
    }
  }

  return items;
}

function summarizeInput(input?: Record<string, unknown>): string {
  if (!input) return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  const val = input[keys[0]];
  if (typeof val === "string") {
    return val.length > 20 ? val.slice(0, 20) + "..." : val;
  }
  return keys[0];
}
