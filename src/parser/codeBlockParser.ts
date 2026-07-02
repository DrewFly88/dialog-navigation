import { QPMessage, IndexItem } from "../types";
import { getPlainText } from "./topicExtractor";
import { smartTruncate } from "./utils";

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

/**
 * Detect file name from various comment patterns in the first lines.
 */
function detectFileName(code: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();

    // Pattern 1: filename.ext (explicit path comment)  e.g. // main.py
    const pathMatch = line.match(
      /^[/#*]+\s*(?:File|file|@file)?\s*(.+?\.\w{1,6})\s*$/
    );
    if (pathMatch) return pathMatch[1].trim();

    // Pattern 2: just "filename.py" as comment on first line
    const simpleMatch = line.match(/^[/#*]+\s*([\w.\-]+\.\w{1,6})\s*$/);
    if (simpleMatch) return simpleMatch[1];
  }
  return "";
}

/**
 * Infer what the code does from its first meaningful line.
 * Returns: function name, class name, or the first non-import line preview.
 */
function inferCodePurpose(code: string, lang: string): string {
  const lines = code.split("\n").map((l) => l.trim());
  for (const line of lines) {
    // Skip empty, comments, imports
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*"))
      continue;
    if (line.startsWith("import ") || line.startsWith("from ") || line.startsWith("require"))
      continue;
    if (line.startsWith("using ") || line.startsWith("#include") || line.startsWith("package "))
      continue;

    // Function declaration
    const fnMatch = line.match(
      /(?:function\s+)?(\w+)\s*\(/
    );
    if (fnMatch) return fnMatch[1] + "()";

    // Class declaration
    const clsMatch = line.match(/class\s+(\w+)/);
    if (clsMatch) return clsMatch[1];

    // Arrow function / variable assignment
    const assignMatch = line.match(
      /(?:const|let|var|def)\s+(\w+)\s*[=:(]/
    );
    if (assignMatch) return assignMatch[1];

    // First meaningful line — show a short preview
    return smartTruncate(line, 20);
  }
  return "";
}

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
        const lang = match[1] || "txt";
        const codeBody = match[2];
        const lineCount = codeBody.split("\n").length;

        // Skip very short code blocks (less than 3 lines)
        if (lineCount < 3) continue;

        const fileName = detectFileName(codeBody);
        const purpose = inferCodePurpose(codeBody, lang);

        let title: string;
        if (fileName) {
          title = lang + " - " + fileName;
        } else if (purpose) {
          title = lang + " - " + purpose;
        } else {
          // Fallback: show first meaningful line
          const firstLine = codeBody
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith("//") && !l.startsWith("#"));
          title = lang + (firstLine ? " - " + smartTruncate(firstLine, 15) : "");
        }

        items.push({
          id: "code-" + items.length,
          group: "code",
          title: smartTruncate(title, 35),
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
