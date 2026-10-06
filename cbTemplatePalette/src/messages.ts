import type { ListNode, TemplateMeta, ViewMode } from "./types";

export type UiToPluginMessage =
  | { type: "LIST" }
  /**
   * `includeImages` は保存時に「画像を含める」を選んだときだけ true。
   * 画像が選択に含まれる場合は必ず UI が確認してから送るので、
   * ここが undefined かつ画像ありなら保存は始まらない。
   */
  | { type: "SAVE_SELECTION"; includeImages?: boolean }
  | { type: "PLACE"; id: string }
  | { type: "RENAME"; id: string; name: string }
  | { type: "DELETE"; id: string }
  /** `ids: null` exports every template. */
  | { type: "EXPORT"; ids: string[] | null }
  | { type: "IMPORT"; files: Array<{ name: string; text: string }> }
  /** 一覧の要素を選んだときに、Figma 側の選択を解除する。 */
  | { type: "CLEAR_CANVAS_SELECTION" }
  /** The UI generates the id so it can open the name field right after. */
  | { type: "ADD_GROUP"; id: string; name: string }
  | { type: "RENAME_GROUP"; id: string; name: string }
  /** Deletes the group and the templates inside it. */
  | { type: "DELETE_GROUP"; id: string }
  /** Writes one group, with its templates, as one file. */
  | { type: "EXPORT_GROUP"; id: string }
  /** Folds or unfolds the group; the choice is remembered per group. */
  | { type: "TOGGLE_GROUP"; id: string; collapsed: boolean }
  /** `groupId: null` targets the root. `index` counts the dragged node itself. */
  | { type: "MOVE"; nodeId: string; groupId: string | null; index: number }
  /** 一覧の見た目だけを切り替える。並び順やグループには影響しない。 */
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "RESIZE_UI"; height: number };

export type PluginToUiMessage =
  | {
      type: "TEMPLATES";
      templates: TemplateMeta[];
      /** List order and groups; reconciled against `templates` before sending. */
      tree: ListNode[];
      /** 一覧の見た目。UI ごとの好みなので、読み込み時に返す。 */
      viewMode: ViewMode;
      usedBytes: number;
      quotaBytes: number;
    }
  | {
      type: "SELECTION_STATE";
      savableCount: number;
      isComponent: boolean;
      /** 選択されているノード数。保存できないノードも含む。 */
      selectionCount: number;
      /** 保存できないノードの数。1 件でもあると保存しない。 */
      unsupportedCount: number;
      /** `plugin` はプラグイン自身が選択を変更した場合（一覧の選択を解除しない）。 */
      origin: "user" | "plugin";
    }
  | { type: "BUSY"; message: string | null }
  /** 保存対象に画像があるため、含めるか選ばせる。選ぶまで保存は始まらない。 */
  | {
      type: "ASK_IMAGES";
      /** 選択内で見た画像の種類数（同じ画像は 1 つに数える）。 */
      count: number;
      /** その画像のバイト列合計。 */
      bytes: number;
      /** 保存容量の残り。 */
      remaining: number;
      /** 画像を入れると容量を超えるため「含める」を選べない。 */
      tooLarge: boolean;
    }
  | { type: "SAVED"; id: string }
  | { type: "EXPORT_DATA"; fileName: string; text: string }
  | { type: "ERROR"; message: string };
