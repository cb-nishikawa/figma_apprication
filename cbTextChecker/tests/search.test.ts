import { describe, expect, it } from "vitest";
import {
  checkKeywords,
  createIndexMap,
  findMatches,
  isExactMatch,
  normalizeForSearch,
  parseKeywords,
} from "../src/search";

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
