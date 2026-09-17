export interface MatchRange {
  start: number;
  end: number;
}

export interface TextMatch {
  nodeId: string;
  nodeName: string;
  preview: string;
  ranges: MatchRange[];
  /** True when the whole TEXT node equals the keyword (newline-aware). */
  exact: boolean;
}

export interface CheckResult {
  keyword: string;
  count: number;
  matches: TextMatch[];
}

export type SearchMode = "selection" | "page" | "pinned";

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
  kind: "SECTION" | "FRAME";
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
