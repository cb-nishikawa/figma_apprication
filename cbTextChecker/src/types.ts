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

export type SearchMode = "pinned" | "compare" | "image";

/** One OCR line from PaddleOCR.js. */
export interface OcrItem {
  id: string;
  text: string;
  score: number;
  /** Quadrilateral points [[x,y], ...] in source image coordinates. */
  poly: Array<[number, number]>;
}

/** One A↔B comparison pair. */
export interface ComparePair {
  idA: string | null;
  idB: string | null;
}

export type HoverHighlightStyle = "component" | "instance";

export type HighlightColor = "red" | "yellow" | "green" | "purple";

/** OCR region on the exported image node (poly in export-pixel coords). */
export interface OcrHighlightRegion {
  id: string;
  exportScale: number;
  poly: Array<[number, number]>;
}

export interface HoverHighlightItem {
  nodeId: string;
  style: HoverHighlightStyle;
  exact: boolean;
  ranges: MatchRange[];
  /** When set, highlight is a region on an image/frame node (not TEXT). */
  ocrRegion?: OcrHighlightRegion;
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
  /** Strip \\n / \\r during match. */
  newlines: boolean;
  /** Half/full-width spaces and tabs. */
  whitespace: boolean;
}

export const DEFAULT_IGNORE_CATEGORIES: IgnoreCategories = {
  emoji: true,
  kinsoku: true,
  symbol: true,
  punct: true,
  newlines: true,
  whitespace: false,
};
