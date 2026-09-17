import type {
  CheckResult,
  CompareSide,
  HighlightColor,
  HoverHighlightItem,
  HoverHighlightStyle,
  IgnoreCategories,
  KeywordQuery,
  PinTarget,
  SearchMode,
} from "./types";

export type { CompareSide, HighlightColor, HoverHighlightStyle, IgnoreCategories };

export type UiToPluginMessage =
  | {
      type: "SET_MODE";
      mode: SearchMode;
      pinnedNodeId?: string | null;
      compareNodeIdA?: string | null;
      compareNodeIdB?: string | null;
    }
  | { type: "SET_PINNED_NODE"; pinnedNodeId: string | null }
  | { type: "SET_PINNED_FROM_SELECTION" }
  | {
      type: "SET_COMPARE_NODE";
      side: CompareSide;
      nodeId: string | null;
    }
  | { type: "SET_COMPARE_FROM_SELECTION"; side: CompareSide }
  | { type: "LIST_PIN_TARGETS" }
  | { type: "LIST_COMPARE_TARGETS" }
  | {
      type: "SEARCH";
      queries: KeywordQuery[];
      ignoreStrings?: string[];
      ignoreCategories?: IgnoreCategories;
    }
  | {
      type: "RUN_COMPARE";
      ignoreStrings?: string[];
      ignoreCategories?: IgnoreCategories;
    }
  | { type: "FOCUS_RESULT"; keyword: string }
  | { type: "FOCUS_NODE"; nodeId: string }
  | { type: "HOVER_HIGHLIGHT"; items: HoverHighlightItem[] }
  | { type: "CLEAR_HIGHLIGHT" }
  | {
      type: "SET_HIGHLIGHT_COLOR";
      color: HighlightColor;
      items: HoverHighlightItem[];
    }
  | { type: "RESIZE_UI"; height: number };

export type PluginToUiMessage =
  | { type: "PIN_TARGETS"; targets: PinTarget[]; pinnedNodeId: string | null }
  | {
      type: "COMPARE_STATE";
      targets: PinTarget[];
      nodeIdA: string | null;
      nodeIdB: string | null;
    }
  | { type: "SEARCH_RESULT"; results: CheckResult[] }
  | { type: "ERROR"; message: string };
