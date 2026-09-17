import type {
  CheckResult,
  HighlightColor,
  HoverHighlightItem,
  HoverHighlightStyle,
  KeywordQuery,
  PinTarget,
  SearchMode,
} from "./types";

export type { HighlightColor, HoverHighlightStyle };

export type UiToPluginMessage =
  | { type: "SET_MODE"; mode: SearchMode; pinnedNodeId?: string | null }
  | { type: "SET_PINNED_NODE"; pinnedNodeId: string | null }
  | { type: "LIST_PIN_TARGETS" }
  | { type: "SEARCH"; queries: KeywordQuery[] }
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
  | { type: "SEARCH_RESULT"; results: CheckResult[] }
  | { type: "ERROR"; message: string };
