import { QPMessage, IndexItem, IndexData, IndexStats } from "../types";
import { extractTopics } from "./topicExtractor";
import { extractToolCalls } from "./toolCallParser";
import { extractCodeBlocks } from "./codeBlockParser";
import { extractConclusions } from "./conclusionParser";

export function parseMessages(messages: QPMessage[]): IndexData {
  const topics = extractTopics(messages);
  const tools = extractToolCalls(messages);
  const codes = extractCodeBlocks(messages);
  const conclusions = extractConclusions(messages);

  // Compute total card count: max bubbleIndex + 1 across all groups.
  // This represents the total number of card groups the SDK will render.
  let totalCards = 0;
  for (const group of [topics, tools, codes, conclusions]) {
    for (const item of group) {
      if (item.bubbleIndex + 1 > totalCards) totalCards = item.bubbleIndex + 1;
    }
  }

  const stats: IndexStats = {
    totalMessages: messages.length,
    totalCards,
    topicCount: topics.length,
    toolCount: tools.length,
    codeCount: codes.length,
    conclusionCount: conclusions.length,
  };

  return { topic: topics, tool: tools, code: codes, conclusion: conclusions, stats };
}
