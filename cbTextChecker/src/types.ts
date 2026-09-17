export interface MatchRange {
  start: number;
  end: number;
}

export type CompareSide = "A" | "B";

export interface TextMatch {
  nodeId: string;
  nodeName: string;
  preview: string;
  ranges: MatchRange[];
  /** True when the whole TEXT node equals the keyword (newline-aware). */
  exact: boolean;
  /** Compare mode: which side the match belongs to. */
  side?: CompareSide;
}

export interface CheckResult {
  keyword: string;
  count: number;
  matches: TextMatch[];
  /** Nested groups (compare: 完全一致/部分一致 → per-text children). */
  children?: CheckResult[];
}

export type SearchMode = "selection" | "page" | "pinned" | "compare";

export type HoverHighlightStyle = "component" | "instance";

export type HighlightColor = "red" | "yellow" | "green" | "purple";

export interface HoverHighlightItem {
  nodeId: string;
  style: HoverHighlightStyle;
  exact: boolean;
  ranges: MatchRange[];
}

export interface PinTarget {
  id: string;
  name: string;
  kind: "SECTION" | "FRAME" | "INSTANCE" | "GROUP";
  label: string;
}

export interface TextNodeLike {
  id: string;
  characters: string;
}

export interface KeywordQuery {
  keyword: string;
  ignoreNewlines: boolean;
}

/** Category toggles for characters ignored during match. */
export interface IgnoreCategories {
  emoji: boolean;
  kinsoku: boolean;
  symbol: boolean;
  punct: boolean;
  /** Half/full-width spaces and tabs. */
  whitespace: boolean;
}

export const DEFAULT_IGNORE_CATEGORIES: IgnoreCategories = {
  emoji: true,
  kinsoku: true,
  symbol: true,
  punct: true,
  whitespace: false,
};
