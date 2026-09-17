import { describe, expect, it } from "vitest";
import {
  checkKeywords,
  createIndexMap,
  findMatches,
  isExactMatch,
  normalizeForSearch,
  parseIgnoreInput,
  parseKeywords,
  stripIgnoreStrings,
} from "../src/search";
import { DEFAULT_IGNORE_CATEGORIES } from "../src/types";

describe("normalizeForSearch", () => {
  it("removes newlines and whitespace", () => {
    expect(normalizeForSearch("お問い合わせは\nこちら")).toBe(
      "お問い合わせはこちら"
    );
    expect(normalizeForSearch("お問い 合わせ　は\tこちら")).toBe(
      "お問い合わせはこちら"
    );
  });
});

describe("stripIgnoreStrings", () => {
  it("removes ignore substrings longest first", () => {
    expect(stripIgnoreStrings("・本校の特長", ["・"])).toBe("本校の特長");
    expect(stripIgnoreStrings("xxAxx", ["xx", "x"])).toBe("A");
  });
});

describe("parseIgnoreInput", () => {
  it("splits whitespace-separated tokens", () => {
    expect(parseIgnoreInput(" ・  - ")).toEqual(["・", "-"]);
  });
});

describe("createIndexMap", () => {
  it("maps normalized indices to original indices across newlines", () => {
    const original = "お問い合わせは\nこちら";
    const map = createIndexMap(original);
    expect(normalizeForSearch(original)).toBe("お問い合わせはこちら");
    expect(map.length).toBe(10);
    // 'こ' after newline
    expect(map[7]).toBe(8);
  });
});

describe("parseKeywords", () => {
  it("trims lines and ignores empty lines", () => {
    expect(
      parseKeywords("  お問い合わせはこちら  \n\n株式会社○○\n  \nプライバシーポリシー")
    ).toEqual([
      "お問い合わせはこちら",
      "株式会社○○",
      "プライバシーポリシー",
    ]);
  });
});

describe("findMatches", () => {
  // Test 1
  it("Test 1: partial match within a single line", () => {
    const ranges = findMatches("お問い合わせはこちら", "お問い合わせ");
    expect(ranges).toEqual([{ start: 0, end: 6 }]);
  });

  // Test 2
  it("Test 2: match across newlines", () => {
    const text = "お問い合わせは\nこちら";
    const ranges = findMatches(text, "お問い合わせはこちら");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ start: 0, end: text.length });
  });

  // Test 3
  it("Test 3: multiple matches in one TEXT node", () => {
    const text = "お問い合わせはこちら。\nお問い合わせはこちらから。";
    const ranges = findMatches(text, "お問い合わせ");
    expect(ranges).toHaveLength(2);
  });

  // Test 7
  it("Test 7: all occurrences in one node", () => {
    const text = "あお問い合わせいお問い合わせう";
    expect(findMatches(text, "お問い合わせ")).toHaveLength(2);
  });

  // Test 8
  it("Test 8: partial match in longer text", () => {
    const text = "これはお問い合わせはこちらという文章です。";
    const ranges = findMatches(text, "お問い合わせ");
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("お問い合わせ");
  });

  // Test 9
  it("Test 9: keyword without newlines matches text with newlines", () => {
    const text = "お問い合わせ\nは\nこちら";
    const ranges = findMatches(text, "お問い合わせはこちら");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0);
    expect(ranges[0].end).toBe(text.length);
  });

  it("returns empty for empty keyword after normalize", () => {
    expect(findMatches("hello", "   \n")).toEqual([]);
  });

  it("does not match across newlines when ignoreNewlines is false", () => {
    const text = "お問い合わせは\nこちら";
    expect(findMatches(text, "お問い合わせはこちら", false)).toEqual([]);
    expect(findMatches(text, "お問い合わせは\nこちら", false)).toEqual([
      { start: 0, end: text.length },
    ]);
  });
});

describe("isExactMatch", () => {
  it("detects exact match of the whole TEXT", () => {
    expect(isExactMatch("お問い合わせはこちら", "お問い合わせはこちら")).toBe(
      true
    );
  });

  it("detects partial match as not exact", () => {
    expect(isExactMatch("これはお問い合わせはこちらです", "お問い合わせ")).toBe(
      false
    );
  });

  it("treats newline-normalized full text as exact", () => {
    expect(
      isExactMatch("お問い合わせは\nこちら", "お問い合わせはこちら", true)
    ).toBe(true);
  });

  it("requires literal equality when ignoreNewlines is false", () => {
    expect(
      isExactMatch("お問い合わせは\nこちら", "お問い合わせはこちら", false)
    ).toBe(false);
    expect(
      isExactMatch("お問い合わせは\nこちら", "お問い合わせは\nこちら", false)
    ).toBe(true);
  });

  it("treats bullet-prefixed text as exact when ・ is ignored", () => {
    expect(
      isExactMatch("本校の特長", "・本校の特長", true, ["・"])
    ).toBe(true);
  });

  it("treats bullet as exact when kinsoku/symbol/punct categories are on", () => {
    expect(
      isExactMatch("本校の特長", "・本校の特長", true, [], {
        ...DEFAULT_IGNORE_CATEGORIES,
        emoji: false,
      })
    ).toBe(true);
  });

  it("treats emoji as ignorable when emoji category is on", () => {
    expect(
      isExactMatch("Hello🎉", "Hello", true, [], {
        emoji: true,
        kinsoku: false,
        symbol: false,
        punct: false,
      })
    ).toBe(true);
  });
});

describe("findMatches with ignoreStrings", () => {
  it("matches after stripping ignore strings and maps ranges to original", () => {
    expect(findMatches("・本校の特長", "本校の特長", true, ["・"])).toEqual([
      { start: 1, end: 6 },
    ]);
  });
});

describe("checkKeywords", () => {
  it("aggregates counts per keyword across nodes", () => {
    const results = checkKeywords(
      [
        { id: "a", characters: "お問い合わせはこちら" },
        { id: "b", characters: "お問い合わせは\nこちら" },
      ],
      [
        { keyword: "お問い合わせはこちら", ignoreNewlines: true },
        { keyword: "プライバシーポリシー", ignoreNewlines: true },
      ]
    );

    expect(results[0].keyword).toBe("お問い合わせはこちら");
    expect(results[0].count).toBe(2);
    expect(results[0].matches).toHaveLength(2);
    expect(results[0].matches[0].exact).toBe(true);
    expect(results[0].matches[1].exact).toBe(true);

    expect(results[1].keyword).toBe("プライバシーポリシー");
    expect(results[1].count).toBe(0);
    expect(results[1].matches).toHaveLength(0);
  });

  it("marks partial node matches as not exact", () => {
    const results = checkKeywords(
      [{ id: "a", characters: "これはお問い合わせです" }],
      [{ keyword: "お問い合わせ", ignoreNewlines: true }]
    );
    expect(results[0].matches[0].exact).toBe(false);
  });

  it("emits one TextMatch per occurrence in the same node", () => {
    const results = checkKeywords(
      [{ id: "a", characters: "テキストテキストテキストテキ" }],
      [{ keyword: "テキスト", ignoreNewlines: true }]
    );
    expect(results[0].count).toBe(3);
    expect(results[0].matches).toHaveLength(3);
    expect(results[0].matches.every((m) => m.ranges.length === 1)).toBe(true);
    expect(results[0].matches.every((m) => m.exact === false)).toBe(true);
  });

  it("keeps a newline-spanning hit as a single match", () => {
    const results = checkKeywords(
      [{ id: "a", characters: "テキストが入り\nます" }],
      [{ keyword: "入ります", ignoreNewlines: true }]
    );
    expect(results[0].count).toBe(1);
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].ranges).toHaveLength(1);
  });

  it("applies ignoreNewlines per query", () => {
    const nodes = [{ id: "a", characters: "お問い合わせは\nこちら" }];
    const results = checkKeywords(nodes, [
      { keyword: "お問い合わせはこちら", ignoreNewlines: true },
      { keyword: "お問い合わせはこちら", ignoreNewlines: false },
    ]);
    expect(results[0].count).toBe(1);
    expect(results[1].count).toBe(0);
  });
});
