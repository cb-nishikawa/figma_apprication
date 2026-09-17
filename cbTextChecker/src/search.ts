import type {
  CheckResult,
  KeywordQuery,
  MatchRange,
  TextMatch,
  TextNodeLike,
} from "./types";

/** Characters removed/ignored during search normalization. */
const IGNORE_CHARS = /[\n\r\t \u3000]/;

function isIgnoredChar(ch: string): boolean {
  return IGNORE_CHARS.test(ch);
}

/**
 * Build a search string by removing newlines and whitespace.
 * Does not mutate the original text.
 */
export function normalizeForSearch(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (!isIgnoredChar(text[i])) {
      result += text[i];
    }
  }
  return result;
}

/**
 * Map each index in the normalized string back to the original UTF-16 index.
 */
export function createIndexMap(original: string): number[] {
  const map: number[] = [];
  for (let i = 0; i < original.length; i++) {
    if (!isIgnoredChar(original[i])) {
      map.push(i);
    }
  }
  return map;
}

/**
 * Parse textarea input into trimmed, non-empty keywords (one per line).
 */
export function parseKeywords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Find all non-overlapping substring matches.
 * When ignoreNewlines is true (default), newlines/whitespace are ignored.
 * Returned ranges use original-text indices (end exclusive).
 */
export function findMatches(
  original: string,
  keyword: string,
  ignoreNewlines = true
): MatchRange[] {
  if (!ignoreNewlines) {
    const exactKeyword = keyword.trim();
    if (!exactKeyword) {
      return [];
    }

    const ranges: MatchRange[] = [];
    let from = 0;
    while (from <= original.length - exactKeyword.length) {
      const found = original.indexOf(exactKeyword, from);
      if (found === -1) {
        break;
      }
      ranges.push({ start: found, end: found + exactKeyword.length });
      from = found + exactKeyword.length;
    }
    return ranges;
  }

  const normalizedKeyword = normalizeForSearch(keyword);
  if (!normalizedKeyword) {
    return [];
  }

  const normalizedText = normalizeForSearch(original);
  const indexMap = createIndexMap(original);
  const ranges: MatchRange[] = [];

  let from = 0;
  while (from <= normalizedText.length - normalizedKeyword.length) {
    const found = normalizedText.indexOf(normalizedKeyword, from);
    if (found === -1) {
      break;
    }

    const startNorm = found;
    const endNorm = found + normalizedKeyword.length - 1;
    const start = indexMap[startNorm];
    const endOriginalInclusive = indexMap[endNorm];

    if (start !== undefined && endOriginalInclusive !== undefined) {
      ranges.push({
        start,
        end: endOriginalInclusive + 1,
      });
    }

    from = found + normalizedKeyword.length;
  }

  return ranges;
}

/**
 * Whether the whole TEXT content equals the keyword.
 * When ignoreNewlines is true, compare after stripping newlines/whitespace.
 */
export function isExactMatch(
  characters: string,
  keyword: string,
  ignoreNewlines = true
): boolean {
  if (ignoreNewlines) {
    const normalizedKeyword = normalizeForSearch(keyword);
    if (!normalizedKeyword) {
      return false;
    }
    return normalizeForSearch(characters) === normalizedKeyword;
  }

  const exactKeyword = keyword.trim();
  if (!exactKeyword) {
    return false;
  }
  return characters === exactKeyword;
}

/**
 * Run keyword checks against a list of text nodes (already deduplicated).
 * Each query carries its own ignoreNewlines flag.
 */
export function checkKeywords(
  nodes: TextNodeLike[],
  queries: KeywordQuery[]
): CheckResult[] {
  return queries.map(({ keyword, ignoreNewlines }) => {
    const matches: TextMatch[] = [];
    let count = 0;

    for (const node of nodes) {
      const ranges = findMatches(node.characters, keyword, ignoreNewlines);
      if (ranges.length > 0) {
        matches.push({
          nodeId: node.id,
          nodeName: "",
          preview: "",
          ranges,
          exact: isExactMatch(node.characters, keyword, ignoreNewlines),
        });
        count += ranges.length;
      }
    }

    return { keyword, count, matches };
  });
}

/**
 * Deduplicate text nodes by id, preserving first occurrence order.
 */
export function dedupeTextNodes<T extends { id: string }>(nodes: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const node of nodes) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      result.push(node);
    }
  }
  return result;
}
