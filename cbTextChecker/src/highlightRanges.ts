import type { MatchRange } from "./types";

/**
 * Split a match range at newline characters so each returned range
 * is a contiguous highlight segment (newlines themselves are excluded).
 */
export function splitRangeByNewlines(
  characters: string,
  range: MatchRange
): MatchRange[] {
  const start = Math.max(0, range.start);
  const end = Math.min(characters.length, range.end);
  if (start >= end) {
    return [];
  }

  const segments: MatchRange[] = [];
  let segmentStart = start;

  for (let i = start; i < end; i++) {
    if (characters[i] === "\n") {
      if (segmentStart < i) {
        segments.push({ start: segmentStart, end: i });
      }
      segmentStart = i + 1;
    }
  }

  if (segmentStart < end) {
    segments.push({ start: segmentStart, end });
  }

  return segments;
}
