import type { TemplateMeta } from "./types";

export type UiToPluginMessage =
  | { type: "LIST" }
  | { type: "SAVE_SELECTION" }
  | { type: "PLACE"; id: string }
  | { type: "RENAME"; id: string; name: string }
  | { type: "DELETE"; id: string }
  /** `ids: null` exports every template. */
  | { type: "EXPORT"; ids: string[] | null }
  | { type: "IMPORT"; files: Array<{ name: string; text: string }> }
  | { type: "RESIZE_UI"; height: number };

export type PluginToUiMessage =
  | {
      type: "TEMPLATES";
      templates: TemplateMeta[];
      usedBytes: number;
      quotaBytes: number;
    }
  | { type: "SELECTION_STATE"; savableCount: number; isComponent: boolean }
  | { type: "BUSY"; message: string | null }
  | { type: "SAVED"; id: string }
  | { type: "EXPORT_DATA"; fileName: string; text: string }
  | { type: "ERROR"; message: string };
