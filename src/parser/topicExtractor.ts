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
          id: "topic-" + items.length,
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
