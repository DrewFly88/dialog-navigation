/**
 * Smart truncation — clips at a natural break (space or punctuation)
 * near the limit, instead of cutting mid-character.
 */
export function smartTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const slice = text.slice(0, limit);
  // Find the last space or punctuation in the slice
  for (let i = slice.length - 1; i >= Math.max(limit - 10, 0); i--) {
    const ch = slice[i];
    if (ch === " " || ch === "," || ch === ";" || ch === "。" || ch === "，" || ch === "；") {
      return slice.slice(0, i) + "...";
    }
  }
  return slice + "...";
}
