import { QPMessage, IndexItem } from "../types";
import { smartTruncate } from "./utils";

export function extractTopics(messages: QPMessage[]): IndexItem[] {
  const items: IndexItem[] = [];
  let cardIdx = 0;
  let prevWasUser = true; // start as true so first non-user increments

  for (const msg of messages) {
    if (msg.role === "user") {
      // User message always starts a new request card
      if (!prevWasUser) cardIdx++;
      prevWasUser = true;

      const text = getPlainText(msg.content);
      if (text.trim().length > 0) {
        const trimmed = text.trim();
        const title = smartTruncate(trimmed, 30);

        items.push({
          id: "topic-" + cardIdx,
          group: "topic",
          title,
          bubbleIndex: cardIdx,
          childIndex: 0,
          timestamp: "",
        });
      }
    } else {
      // Non-user: first one after user starts a new response card
      if (prevWasUser) cardIdx++;
      prevWasUser = false;

      // Skip Thinking/reasoning segments AFTER cardIdx bookkeeping so
      // subsequent message-type replies stay aligned with SDK bubbles.
      // reasoning段不是用户可见回复，不应作话题标题. See DEVLOG §27.8.
      if (msg.type === "reasoning") continue;
    }
  }

  return items;
}

export function getPlainText(
  content: string | { type: string; text?: string }[]
): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text || "")
    .join("");
}
