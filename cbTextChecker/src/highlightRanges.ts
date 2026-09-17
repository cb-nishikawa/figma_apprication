import type { MatchRange } from "./types";

const HEIGHT_EPS = 0.5;

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

/**
 * Further split a (newline-free) range wherever fixed-width layout height increases.
 * `heightBefore(endExclusive)` returns the laid-out height of characters[0, endExclusive).
 */
export function splitRangeByHeightBreaks(
  range: MatchRange,
  heightBefore: (endExclusive: number) => number
): MatchRange[] {
  const start = range.start;
  const end = range.end;
  if (start >= end) {
    return [];
  }

  const segments: MatchRange[] = [];
  let segmentStart = start;
  let prevHeight = heightBefore(start);

  for (let i = start + 1; i <= end; i++) {
    const height = heightBefore(i);
    if (height > prevHeight + HEIGHT_EPS) {
      // Character at i-1 started a new visual line.
      if (segmentStart < i - 1) {
        segments.push({ start: segmentStart, end: i - 1 });
      }
      segmentStart = i - 1;
      prevHeight = height;
    }
  }

  if (segmentStart < end) {
    segments.push({ start: segmentStart, end });
  }

  return segments;
}
