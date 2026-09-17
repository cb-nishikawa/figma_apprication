import type {
  CheckResult,
  IgnoreCategories,
  MatchRange,
  TextMatch,
  TextNodeLike,
} from "./types";
import { findMatches, isExactMatch } from "./search";

export const COMPARE_EXACT = "完全一致";
export const COMPARE_PARTIAL = "部分一致";
export const COMPARE_ONLY_A = "Aのみ";
export const COMPARE_ONLY_B = "Bのみ";

/** @deprecated Use COMPARE_EXACT */
export const COMPARE_MATCHED = COMPARE_EXACT;

const NO_CATEGORIES: IgnoreCategories = {
  emoji: false,
  kinsoku: false,
  symbol: false,
  punct: false,
  whitespace: false,
};

export interface MatchedTextPair {
  a: TextNodeLike;
  b: TextNodeLike;
  rangesA: MatchRange[];
  rangesB: MatchRange[];
  exact: boolean;
}

export interface TextCompareDiff {
  matchedExact: MatchedTextPair[];
  matchedPartial: MatchedTextPair[];
  onlyA: TextNodeLike[];
  onlyB: TextNodeLike[];
}

function fullRange(node: TextNodeLike): MatchRange[] {
  return [{ start: 0, end: node.characters.length }];
}

function tryPartialPair(
  a: TextNodeLike,
  b: TextNodeLike,
  ignoreStrings: string[],
  categories: IgnoreCategories
): MatchedTextPair | null {
  const inB = findMatches(
    b.characters,
    a.characters,
    true,
    ignoreStrings,
    categories
  );
  if (inB.length > 0) {
    return {
      a,
      b,
      rangesA: fullRange(a),
      rangesB: inB,
      exact: false,
    };
  }
  const inA = findMatches(
    a.characters,
    b.characters,
    true,
    ignoreStrings,
    categories
  );
  if (inA.length > 0) {
    return {
      a,
      b,
      rangesA: inA,
      rangesB: fullRange(b),
      exact: false,
    };
  }
  return null;
}

function firstPartialAgainst(
  node: TextNodeLike,
  candidates: TextNodeLike[],
  nodeIsA: boolean,
  ignoreStrings: string[],
  categories: IgnoreCategories
): MatchedTextPair | null {
  for (const other of candidates) {
    const pair = nodeIsA
      ? tryPartialPair(node, other, ignoreStrings, categories)
      : tryPartialPair(other, node, ignoreStrings, categories);
    if (pair) {
      return pair;
    }
  }
  return null;
}

/**
 * Pair A/B text nodes with the same rules as keyword check
 * (ignoreNewlines / normalizeForSearch via isExactMatch + findMatches).
 * Exact pairs are 1:1. Partial matches use existence (opponent not consumed).
 */
export function compareTextNodes(
  a: TextNodeLike[],
  b: TextNodeLike[],
  ignoreStrings: string[] = [],
  categories: IgnoreCategories = NO_CATEGORIES
): TextCompareDiff {
  const unusedA = [...a];
  const unusedB = [...b];
  const matchedExact: MatchedTextPair[] = [];

  for (let i = 0; i < unusedA.length; i++) {
    const nodeA = unusedA[i];
    let found = -1;
    for (let j = 0; j < unusedB.length; j++) {
      if (
        isExactMatch(
          nodeA.characters,
          unusedB[j].characters,
          true,
          ignoreStrings,
          categories
        )
      ) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      continue;
    }
    const nodeB = unusedB[found];
    matchedExact.push({
      a: nodeA,
      b: nodeB,
      rangesA: fullRange(nodeA),
      rangesB: fullRange(nodeB),
      exact: true,
    });
    unusedA.splice(i, 1);
    unusedB.splice(found, 1);
    i--;
  }

  const matchedPartial: MatchedTextPair[] = [];
  const partialAIds = new Set<string>();
  const partialBIds = new Set<string>();

  for (const nodeA of unusedA) {
    const pair = firstPartialAgainst(
      nodeA,
      unusedB,
      true,
      ignoreStrings,
      categories
    );
    if (!pair) {
      continue;
    }
    matchedPartial.push(pair);
    partialAIds.add(nodeA.id);
    partialBIds.add(pair.b.id);
  }

  for (const nodeB of unusedB) {
    if (partialBIds.has(nodeB.id)) {
      continue;
    }
    const pair = firstPartialAgainst(
      nodeB,
      unusedA,
      false,
      ignoreStrings,
      categories
    );
    if (!pair) {
      continue;
    }
    matchedPartial.push(pair);
    partialAIds.add(pair.a.id);
    partialBIds.add(nodeB.id);
  }

  return {
    matchedExact,
    matchedPartial,
    onlyA: unusedA.filter((n) => !partialAIds.has(n.id)),
    onlyB: unusedB.filter((n) => !partialBIds.has(n.id)),
  };
}

/** @deprecated Use compareTextNodes */
export function diffTextMultisets(
  a: TextNodeLike[],
  b: TextNodeLike[],
  ignoreStrings: string[] = [],
  categories: IgnoreCategories = NO_CATEGORIES
): TextCompareDiff {
  return compareTextNodes(a, b, ignoreStrings, categories);
}

function toMatch(
  node: TextNodeLike,
  ranges: MatchRange[],
  exact: boolean,
  side?: "A" | "B"
): TextMatch {
  return {
    nodeId: node.id,
    nodeName: "",
    preview: "",
    ranges,
    exact,
    side,
  };
}

function pairKeyword(node: TextNodeLike): string {
  const flat = node.characters.replace(/\s+/g, " ").trim();
  return flat.length > 0 ? flat : "(空)";
}

function pairsToChildren(
  pairs: MatchedTextPair[],
  exact: boolean
): CheckResult[] {
  const usedKeywords = new Map<string, number>();
  return pairs.map((pair) => {
    const matches = [
      toMatch(pair.a, pair.rangesA, exact, "A"),
      toMatch(pair.b, pair.rangesB, exact, "B"),
    ];
    const base = pairKeyword(pair.a);
    const seen = usedKeywords.get(base) ?? 0;
    usedKeywords.set(base, seen + 1);
    const keyword = seen === 0 ? base : `${base} (${seen + 1})`;
    return {
      keyword,
      count: matches.length,
      matches,
    };
  });
}

function categoryResult(
  keyword: string,
  children: CheckResult[]
): CheckResult {
  const matches = children.flatMap((child) => child.matches);
  return {
    keyword,
    count: matches.length,
    matches,
    children,
  };
}

/** Build CheckResult[] for UI accordion (nested exact/partial + Aのみ / Bのみ). */
export function compareDiffToResults(diff: TextCompareDiff): CheckResult[] {
  return [
    categoryResult(COMPARE_EXACT, pairsToChildren(diff.matchedExact, true)),
    categoryResult(
      COMPARE_PARTIAL,
      pairsToChildren(diff.matchedPartial, false)
    ),
    {
      keyword: COMPARE_ONLY_A,
      count: diff.onlyA.length,
      matches: diff.onlyA.map((n) => toMatch(n, fullRange(n), true, "A")),
    },
    {
      keyword: COMPARE_ONLY_B,
      count: diff.onlyB.length,
      matches: diff.onlyB.map((n) => toMatch(n, fullRange(n), true, "B")),
    },
  ];
}
