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
  /** 一覧の要素を選んだときに、Figma 側の選択を解除する。 */
  | { type: "CLEAR_CANVAS_SELECTION" }
  | { type: "RESIZE_UI"; height: number };

export type PluginToUiMessage =
  | {
      type: "TEMPLATES";
      templates: TemplateMeta[];
      usedBytes: number;
      quotaBytes: number;
    }
  | {
      type: "SELECTION_STATE";
      savableCount: number;
      isComponent: boolean;
      /** 選択されているノード数。保存できないノードも含む。 */
      selectionCount: number;
      /** `plugin` はプラグイン自身が選択を変更した場合（一覧の選択を解除しない）。 */
      origin: "user" | "plugin";
    }
  | { type: "BUSY"; message: string | null }
  | { type: "SAVED"; id: string }
  | { type: "EXPORT_DATA"; fileName: string; text: string }
  | { type: "ERROR"; message: string };
