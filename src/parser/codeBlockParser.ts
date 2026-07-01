import { QPMessage, IndexItem } from "../types";
import { getPlainText } from "./topicExtractor";

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

export function extractCodeBlocks(messages: QPMessage[]): IndexItem[] {
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
      let match: RegExpExecArray | null;
      CODE_BLOCK_RE.lastIndex = 0;

      while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
        const lang = match[1] || "text";
        const codeBody = match[2];
        const fileName = detectFileName(codeBody, lang);
        const firstLine = codeBody.split("\n")[0].trim();
        const title = fileName
          ? lang + " - " + fileName
          : firstLine
            ? lang +
              " - " +
              (firstLine.length > 20
                ? firstLine.slice(0, 20) + "..."
                : firstLine)
            : lang;

        items.push({
          id: "code-" + items.length,
          group: "code",
          title: title.length > 35 ? title.slice(0, 35) + "..." : title,
          bubbleIndex: cardIdx,
          timestamp: "",
          lang,
          fileName: fileName || undefined,
        });
      }
    }
  }

  return items;
}

function detectFileName(code: string, _lang: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const line = lines[i].trim();
    const commentMatch = line.match(/^[/#*]+\s*(.+?\.\w{1,6})\s*$/);
    if (commentMatch) return commentMatch[1];
  }
  return "";
}
