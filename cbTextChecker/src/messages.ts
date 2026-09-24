import type {
  CheckResult,
  ComparePair,
  CompareSide,
  HighlightColor,
  HoverHighlightItem,
  HoverHighlightStyle,
  IgnoreCategories,
  KeywordQuery,
  PinTarget,
  SearchMode,
  TextNodeLike,
} from "./types";

export type { CompareSide, HighlightColor, HoverHighlightStyle, IgnoreCategories };

/** Identifies which target-picker button requested a selection apply. */
export type SelectionSlot =
  | { kind: "pin" }
  | { kind: "compare"; index: number; side: CompareSide }
  | { kind: "image" }
  | { kind: "imageTarget" };

export type UiToPluginMessage =
  | {
      type: "SET_MODE";
      mode: SearchMode;
      pinnedNodeId?: string | null;
      comparePairs?: ComparePair[];
      imageTargetId?: string | null;
    }
  | { type: "SET_PINNED_NODE"; pinnedNodeId: string | null }
  | { type: "SET_PINNED_FROM_SELECTION" }
  | { type: "SET_COMPARE_PAIRS"; pairs: ComparePair[] }
  | {
      type: "SET_COMPARE_PAIR";
      index: number;
      side: CompareSide;
      nodeId: string | null;
    }
  | {
      type: "SET_COMPARE_FROM_SELECTION";
      index: number;
      side: CompareSide;
    }
  | { type: "LIST_PIN_TARGETS" }
  | { type: "LIST_COMPARE_TARGETS" }
  | { type: "LIST_IMAGE_TARGETS" }
  | { type: "EXPORT_IMAGE_FROM_SELECTION" }
  | { type: "EXPORT_IMAGE_NODE"; nodeId: string }
  | { type: "CLEAR_IMAGE" }
  | { type: "SET_IMAGE_COMPARE_TARGET"; targetId: string | null }
  | { type: "SET_IMAGE_TARGET_FROM_SELECTION" }
  | {
      type: "RUN_IMAGE_COMPARE";
      ocrTexts: TextNodeLike[];
      imageNodeId: string;
      exportScale: number;
      ocrRegions: Array<{
        id: string;
        poly: Array<[number, number]>;
        text: string;
      }>;
      ignoreStrings?: string[];
      ignoreCategories?: IgnoreCategories;
    }
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
  | { type: "BUILD_HIGHLIGHT_POOL"; items: HoverHighlightItem[] }
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
      pairs: ComparePair[];
    }
  | {
      type: "IMAGE_STATE";
      targets: PinTarget[];
      targetId: string | null;
    }
  | {
      type: "IMAGE_EXPORTED";
      nodeId: string;
      name: string;
      bytes: number[];
      exportScale: number;
    }
  | { type: "IMAGE_CLEARED" }
  | { type: "SELECTION_EMPTY"; slot: SelectionSlot }
  | { type: "SEARCH_RESULT"; results: CheckResult[] }
  | { type: "ERROR"; message: string };
