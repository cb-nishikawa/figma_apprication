import { describe, expect, it } from "vitest";
import {
  COMPARE_EXACT,
  COMPARE_ONLY_A,
  COMPARE_ONLY_B,
  COMPARE_PARTIAL,
  compareDiffToResults,
  compareTextNodes,
} from "../src/compare";

describe("compareTextNodes", () => {
  it("pairs exact matches ignoring layer order", () => {
    const diff = compareTextNodes(
      [
        { id: "a1", characters: "hello" },
        { id: "a2", characters: "world" },
      ],
      [
        { id: "b1", characters: "world" },
        { id: "b2", characters: "hello" },
      ]
    );
    expect(diff.matchedExact).toHaveLength(2);
    expect(diff.matchedPartial).toEqual([]);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
  });

  it("treats newline-only differences as exact", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "hello\nworld" }],
      [{ id: "b1", characters: "helloworld" }]
    );
    expect(diff.matchedExact).toHaveLength(1);
    expect(diff.matchedExact[0].a.id).toBe("a1");
    expect(diff.matchedExact[0].b.id).toBe("b1");
    expect(diff.matchedPartial).toEqual([]);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
  });

  it("does not treat space differences as exact by default", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "hello\nworld" }],
      [{ id: "b1", characters: "hello world" }]
    );
    expect(diff.matchedExact).toEqual([]);
    expect(diff.matchedPartial).toEqual([]);
    expect(diff.onlyA.map((n) => n.id)).toEqual(["a1"]);
    expect(diff.onlyB.map((n) => n.id)).toEqual(["b1"]);
  });

  it("treats space differences as exact when whitespace category is on", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "hello\nworld" }],
      [{ id: "b1", characters: "hello world" }],
      [],
      {
        emoji: false,
        kinsoku: false,
        symbol: false,
        punct: false,
        whitespace: true,
      }
    );
    expect(diff.matchedExact).toHaveLength(1);
    expect(diff.matchedPartial).toEqual([]);
  });

  it("pairs partial substring matches", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "foo" }],
      [{ id: "b1", characters: "foo bar" }]
    );
    expect(diff.matchedExact).toEqual([]);
    expect(diff.matchedPartial).toHaveLength(1);
    expect(diff.matchedPartial[0].a.id).toBe("a1");
    expect(diff.matchedPartial[0].b.id).toBe("b1");
    expect(diff.matchedPartial[0].rangesB).toEqual([{ start: 0, end: 3 }]);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
  });

  it("allows multiple A texts to partially match one B text", () => {
    const diff = compareTextNodes(
      [
        { id: "a1", characters: "foo" },
        { id: "a2", characters: "bar" },
      ],
      [{ id: "b1", characters: "foo bar" }]
    );
    expect(diff.matchedExact).toEqual([]);
    expect(diff.matchedPartial).toHaveLength(2);
    expect(diff.matchedPartial.map((p) => p.a.id).sort()).toEqual([
      "a1",
      "a2",
    ]);
    expect(diff.matchedPartial.every((p) => p.b.id === "b1")).toBe(true);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
  });

  it("allows multiple B texts to partially match one A text", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "foo bar" }],
      [
        { id: "b1", characters: "foo" },
        { id: "b2", characters: "bar" },
      ]
    );
    expect(diff.matchedExact).toEqual([]);
    expect(diff.matchedPartial).toHaveLength(2);
    expect(diff.matchedPartial.every((p) => p.a.id === "a1")).toBe(true);
    expect(diff.matchedPartial.map((p) => p.b.id).sort()).toEqual([
      "b1",
      "b2",
    ]);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
  });

  it("keeps surplus duplicates on one side after exact pairing", () => {
    const diff = compareTextNodes(
      [
        { id: "a1", characters: "x" },
        { id: "a2", characters: "x" },
        { id: "a3", characters: "x" },
      ],
      [{ id: "b1", characters: "x" }]
    );
    expect(diff.matchedExact).toHaveLength(1);
    expect(diff.onlyA.map((n) => n.id)).toEqual(["a2", "a3"]);
    expect(diff.onlyB).toEqual([]);
  });

  it("reports texts only on B", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "same" }],
      [
        { id: "b1", characters: "same" },
        { id: "b2", characters: "extra" },
      ]
    );
    expect(diff.matchedExact).toHaveLength(1);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([{ id: "b2", characters: "extra" }]);
  });

  it("treats ・-prefixed texts as exact when ・ is ignored", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "本校の特長" }],
      [{ id: "b1", characters: "・本校の特長" }],
      ["・"]
    );
    expect(diff.matchedExact).toHaveLength(1);
    expect(diff.matchedPartial).toEqual([]);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
  });

  it("treats ・-prefixed texts as exact when symbol category is on", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "本校の特長" }],
      [{ id: "b1", characters: "・本校の特長" }],
      [],
      { emoji: false, kinsoku: false, symbol: true, punct: false, whitespace: false }
    );
    expect(diff.matchedExact).toHaveLength(1);
    expect(diff.matchedPartial).toEqual([]);
  });

  it("keeps partial match without ignore strings for ・ prefix", () => {
    const diff = compareTextNodes(
      [{ id: "a1", characters: "本校の特長" }],
      [{ id: "b1", characters: "・本校の特長" }]
    );
    expect(diff.matchedExact).toEqual([]);
    expect(diff.matchedPartial).toHaveLength(1);
  });
});

describe("compareDiffToResults", () => {
  it("nests exact/partial children with A/B matches; Aのみ/Bのみ stay flat", () => {
    const results = compareDiffToResults({
      matchedExact: [
        {
          a: { id: "a0", characters: "ok" },
          b: { id: "b0", characters: "ok" },
          rangesA: [{ start: 0, end: 2 }],
          rangesB: [{ start: 0, end: 2 }],
          exact: true,
        },
        {
          a: { id: "a0b", characters: "ok" },
          b: { id: "b0b", characters: "ok" },
          rangesA: [{ start: 0, end: 2 }],
          rangesB: [{ start: 0, end: 2 }],
          exact: true,
        },
      ],
      matchedPartial: [
        {
          a: { id: "a2", characters: "foo" },
          b: { id: "b2", characters: "foo bar" },
          rangesA: [{ start: 0, end: 3 }],
          rangesB: [{ start: 0, end: 3 }],
          exact: false,
        },
      ],
      onlyA: [{ id: "a1", characters: "alone" }],
      onlyB: [{ id: "b1", characters: "extra" }],
    });
    expect(results).toHaveLength(4);

    const exact = results[0];
    expect(exact.keyword).toBe(COMPARE_EXACT);
    expect(exact.count).toBe(4);
    expect(exact.children).toHaveLength(2);
    expect(exact.children![0].keyword).toBe("ok");
    expect(exact.children![0].count).toBe(2);
    expect(exact.children![0].matches).toHaveLength(2);
    expect(exact.children![0].matches.map((m) => m.side)).toEqual(["A", "B"]);
    expect(exact.children![0].matches.every((m) => m.exact)).toBe(true);
    expect(exact.children![1].keyword).toBe("ok (2)");
    expect(exact.children![1].matches.map((m) => m.side)).toEqual(["A", "B"]);

    const partial = results[1];
    expect(partial.keyword).toBe(COMPARE_PARTIAL);
    expect(partial.count).toBe(2);
    expect(partial.children).toHaveLength(1);
    expect(partial.children![0].keyword).toBe("foo");
    expect(partial.children![0].matches).toHaveLength(2);
    expect(partial.children![0].matches.map((m) => m.side)).toEqual(["A", "B"]);
    expect(partial.children![0].matches.every((m) => !m.exact)).toBe(true);

    expect(results[2].keyword).toBe(COMPARE_ONLY_A);
    expect(results[2].count).toBe(1);
    expect(results[2].children).toBeUndefined();
    expect(results[2].matches[0].side).toBe("A");

    expect(results[3].keyword).toBe(COMPARE_ONLY_B);
    expect(results[3].count).toBe(1);
    expect(results[3].children).toBeUndefined();
    expect(results[3].matches[0].side).toBe("B");
  });
});
