import type {
  CheckResult,
  IgnoreCategories,
  KeywordQuery,
  MatchRange,
  TextMatch,
  TextNodeLike,
} from "./types";
import { DEFAULT_IGNORE_CATEGORIES } from "./types";

export type { IgnoreCategories };
export { DEFAULT_IGNORE_CATEGORIES };

const NO_CATEGORIES: IgnoreCategories = {
  emoji: false,
  kinsoku: false,
  symbol: false,
  punct: false,
  newlines: false,
  whitespace: false,
};

/** Newline characters removed when ignoreNewlines is true. */
const NEWLINE_CHARS = /[\n\r]/;

/** Spaces / tabs removed when categories.whitespace is true. */
const WHITESPACE_CHARS = /[ \t\u3000]/;

/** Representative Japanese kinsoku / line-break sensitive characters. */
export const KINSOKU_CHARS = new Set(
  Array.from("、。．，．・：；！？々ー〜「」『』（）〔〕［］【】〈〉《》")
);

/** Punctuation characters. */
export const PUNCT_CHARS = new Set(
  Array.from("、。．，．!！?？…‥,.;:・")
);

/** Common symbol marks (overlaps with kinsoku/punct are fine). */
const SYMBOL_CHARS = new Set(
  Array.from(
    "・…‥ー〜※＊★☆●○◆◇■□▲△▼▽♪†‡§¶©®™°′″≒≠≦≧±×÷∞∴∵←→↑↓⇔⇒"
  )
);

const ASCII_SYMBOL = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const FULLWIDTH_SYMBOL =
  /[！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～]/;

function isNewlineChar(ch: string): boolean {
  return NEWLINE_CHARS.test(ch);
}

function isWhitespaceChar(ch: string): boolean {
  return WHITESPACE_CHARS.test(ch);
}

function isEmojiCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x1f600 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x2600 && cp <= 0x26ff) ||
    (cp >= 0x2700 && cp <= 0x27bf) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x200d ||
    cp === 0x20e3 ||
    (cp >= 0x1f1e6 && cp <= 0x1f1ff)
  );
}

function isLetterOrNumberOrKana(cp: number): boolean {
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  if (cp >= 0x41 && cp <= 0x5a) return true; // A-Z
  if (cp >= 0x61 && cp <= 0x7a) return true; // a-z
  if (cp >= 0xff10 && cp <= 0xff19) return true; // fullwidth digits
  if (cp >= 0xff21 && cp <= 0xff3a) return true;
  if (cp >= 0xff41 && cp <= 0xff5a) return true;
  if (cp >= 0x3040 && cp <= 0x309f) return true; // hiragana
  if (cp >= 0x30a0 && cp <= 0x30ff) return true; // katakana
  if (cp >= 0x3400 && cp <= 0x9fff) return true; // CJK
  if (cp >= 0xf900 && cp <= 0xfaff) return true;
  return false;
}

export function shouldSkipByCategory(
  ch: string,
  cp: number,
  categories: IgnoreCategories
): boolean {
  if (categories.emoji && isEmojiCodePoint(cp)) {
    return true;
  }
  if (categories.kinsoku && KINSOKU_CHARS.has(ch)) {
    return true;
  }
  if (categories.punct && PUNCT_CHARS.has(ch)) {
    return true;
  }
  if (categories.newlines && isNewlineChar(ch)) {
    return true;
  }
  if (categories.whitespace && isWhitespaceChar(ch)) {
    return true;
  }
  if (categories.symbol) {
    if (SYMBOL_CHARS.has(ch) || ASCII_SYMBOL.test(ch) || FULLWIDTH_SYMBOL.test(ch)) {
      return true;
    }
    // Other non-letter/number marks in common symbol blocks
    if (
      !isLetterOrNumberOrKana(cp) &&
      !isWhitespaceChar(ch) &&
      !isNewlineChar(ch) &&
      ((cp >= 0x2000 && cp <= 0x206f) ||
        (cp >= 0x2190 && cp <= 0x21ff) ||
        (cp >= 0x2200 && cp <= 0x22ff) ||
        (cp >= 0x2500 && cp <= 0x257f) ||
        (cp >= 0x25a0 && cp <= 0x25ff) ||
        (cp >= 0x3000 && cp <= 0x303f))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Remove user-configured ignore substrings (longest first).
 * Does not mutate the original text.
 */
export function stripIgnoreStrings(text: string, ignores: string[]): string {
  const sorted = uniqueSortedIgnores(ignores);
  if (sorted.length === 0) {
    return text;
  }

  let result = "";
  let i = 0;
  while (i < text.length) {
    let skipped = false;
    for (const ignore of sorted) {
      if (text.startsWith(ignore, i)) {
        i += ignore.length;
        skipped = true;
        break;
      }
    }
    if (skipped) {
      continue;
    }
    result += text[i];
    i++;
  }
  return result;
}

function uniqueSortedIgnores(ignores: string[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of ignores) {
    const value = raw.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    list.push(value);
  }
  list.sort((a, b) => b.length - a.length);
  return list;
}

/**
 * Parse single-line ignore input (whitespace-separated tokens).
 */
export function parseIgnoreInput(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Build searchable string and map each searchable index back to original UTF-16.
 * Optionally strips ignore substrings, category characters, and/or whitespace.
 * Newlines: stripped when ignoreNewlines is true or categories.newlines is true.
 */
export function buildSearchIndex(
  original: string,
  ignores: string[] = [],
  ignoreNewlines = true,
  categories: IgnoreCategories = NO_CATEGORIES
): { searchable: string; indexMap: number[] } {
  const sorted = uniqueSortedIgnores(ignores);
  const indexMap: number[] = [];
  let searchable = "";
  let i = 0;
  const stripNewlines = ignoreNewlines || categories.newlines;

  while (i < original.length) {
    let skipped = false;
    for (const ignore of sorted) {
      if (original.startsWith(ignore, i)) {
        i += ignore.length;
        skipped = true;
        break;
      }
    }
    if (skipped) {
      continue;
    }

    const cp = original.codePointAt(i)!;
    const unitLen = cp > 0xffff ? 2 : 1;
    const ch = original.slice(i, i + unitLen);

    if (shouldSkipByCategory(ch, cp, categories)) {
      i += unitLen;
      continue;
    }

    if (stripNewlines && unitLen === 1 && isNewlineChar(ch)) {
      i++;
      continue;
    }

    for (let u = 0; u < unitLen; u++) {
      searchable += original[i + u];
      indexMap.push(i + u);
    }
    i += unitLen;
  }

  return { searchable, indexMap };
}

/**
 * Build a search string by removing newlines (spaces kept).
 * Does not mutate the original text.
 */
export function normalizeForSearch(text: string): string {
  return buildSearchIndex(text, [], true).searchable;
}

/**
 * Map each index in the normalized string back to the original UTF-16 index.
 */
export function createIndexMap(original: string): number[] {
  return buildSearchIndex(original, [], true).indexMap;
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
 * When ignoreNewlines is true (default), newlines are ignored.
 * ignoreStrings / categories are stripped before matching. Ranges use original indices.
 */
export function findMatches(
  original: string,
  keyword: string,
  ignoreNewlines = true,
  ignoreStrings: string[] = [],
  categories: IgnoreCategories = NO_CATEGORIES
): MatchRange[] {
  const hasCategory =
    categories.emoji ||
    categories.kinsoku ||
    categories.symbol ||
    categories.punct ||
    categories.newlines ||
    categories.whitespace;

  if (!ignoreNewlines && ignoreStrings.length === 0 && !hasCategory) {
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

  const textIndex = buildSearchIndex(
    original,
    ignoreStrings,
    ignoreNewlines,
    categories
  );
  const keywordIndex = buildSearchIndex(
    keyword,
    ignoreStrings,
    ignoreNewlines,
    categories
  );
  const normalizedKeyword = keywordIndex.searchable;
  if (!normalizedKeyword) {
    return [];
  }

  const normalizedText = textIndex.searchable;
  const indexMap = textIndex.indexMap;
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
 * When ignoreNewlines is true, compare after stripping newlines.
 * ignoreStrings / categories are stripped before comparison.
 */
export function isExactMatch(
  characters: string,
  keyword: string,
  ignoreNewlines = true,
  ignoreStrings: string[] = [],
  categories: IgnoreCategories = NO_CATEGORIES
): boolean {
  const left = buildSearchIndex(
    characters,
    ignoreStrings,
    ignoreNewlines,
    categories
  ).searchable;
  const right = buildSearchIndex(
    keyword,
    ignoreStrings,
    ignoreNewlines,
    categories
  ).searchable;
  if (!right) {
    return false;
  }
  return left === right;
}

/**
 * Run keyword checks against a list of text nodes (already deduplicated).
 * Each query carries its own ignoreNewlines flag.
 * One TextMatch is emitted per match range (occurrence).
 */
export function checkKeywords(
  nodes: TextNodeLike[],
  queries: KeywordQuery[],
  ignoreStrings: string[] = [],
  categories: IgnoreCategories = NO_CATEGORIES
): CheckResult[] {
  return queries.map(({ keyword, ignoreNewlines }) => {
    const matches: TextMatch[] = [];

    for (const node of nodes) {
      const ranges = findMatches(
        node.characters,
        keyword,
        ignoreNewlines,
        ignoreStrings,
        categories
      );
      if (ranges.length === 0) {
        continue;
      }
      const exact = isExactMatch(
        node.characters,
        keyword,
        ignoreNewlines,
        ignoreStrings,
        categories
      );
      for (const range of ranges) {
        matches.push({
          nodeId: node.id,
          nodeName: "",
          preview: "",
          ranges: [range],
          exact,
        });
      }
    }

    return { keyword, count: matches.length, matches };
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
