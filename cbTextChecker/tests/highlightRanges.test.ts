import { describe, expect, it } from "vitest";
import {
  splitRangeByHeightBreaks,
  splitRangeByNewlines,
} from "../src/highlightRanges";

describe("splitRangeByNewlines", () => {
  it("returns the range unchanged when there is no newline", () => {
    expect(splitRangeByNewlines("あいう", { start: 0, end: 3 })).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it("splits a full range that spans a newline into two segments", () => {
    expect(splitRangeByNewlines("あ\nい", { start: 0, end: 3 })).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
  });

  it("excludes newline characters from segments", () => {
    const characters = "お問い合わせは\nこちら";
    expect(
      splitRangeByNewlines(characters, { start: 0, end: characters.length })
    ).toEqual([
      { start: 0, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("handles multiple newlines and empty line gaps", () => {
    expect(splitRangeByNewlines("a\n\nbc", { start: 0, end: 5 })).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 5 },
    ]);
  });

  it("returns empty when range is empty or invalid", () => {
    expect(splitRangeByNewlines("abc", { start: 2, end: 2 })).toEqual([]);
    expect(splitRangeByNewlines("abc", { start: 3, end: 1 })).toEqual([]);
  });

  it("splits only within the given range", () => {
    expect(splitRangeByNewlines("あ\nい\nう", { start: 2, end: 5 })).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it("splits 入ります across a hard newline", () => {
    expect(
      splitRangeByNewlines("入り\nます", { start: 0, end: 5 })
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });
});

describe("splitRangeByHeightBreaks", () => {
  it("returns the range unchanged when height never increases", () => {
    expect(
      splitRangeByHeightBreaks({ start: 0, end: 4 }, () => 12)
    ).toEqual([{ start: 0, end: 4 }]);
  });

  it("splits when height jumps mid-range (soft wrap)", () => {
    // Simulate "入ります" wrapping after 2 chars: height 12 then 24.
    const heightBefore = (endExclusive: number) =>
      endExclusive <= 2 ? 12 : 24;
    expect(
      splitRangeByHeightBreaks({ start: 0, end: 4 }, heightBefore)
    ).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns empty for empty range", () => {
    expect(
      splitRangeByHeightBreaks({ start: 2, end: 2 }, () => 0)
    ).toEqual([]);
  });
});
