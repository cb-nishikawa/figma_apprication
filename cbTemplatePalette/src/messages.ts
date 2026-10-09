import type {
  ImportMode,
  LinkedCategoryInfo,
  ListNode,
  SourceConfig,
  StorageErrorKind,
  TemplateMeta,
  ViewMode,
} from "./types";

export type UiToPluginMessage =
  | { type: "LIST" }
  /**
   * `includeImages` は保存時に「画像を含める」を選んだときだけ true。
   * 画像が選択に含まれる場合は必ず UI が確認してから送るので、
   * ここが undefined かつ画像ありなら保存は始まらない。
   * `category` はヘッダーのカテゴリメニューの値。空・undefined は「未設定」。
   */
  | { type: "SAVE_SELECTION"; includeImages?: boolean; category?: string }
  | { type: "PLACE"; id: string }
  | { type: "RENAME"; id: string; name: string }
  | { type: "DELETE"; id: string }
  /** `ids: null` exports every template. */
  | { type: "EXPORT"; ids: string[] | null }
  | { type: "IMPORT"; files: Array<{ name: string; text: string }>; mode: ImportMode }
  /** 一覧の要素を選んだときに、Figma 側の選択を解除する。 */
  | { type: "CLEAR_CANVAS_SELECTION" }
  /** The UI generates the id so it can open the name field right after. */
  /** `category` は今選んでいる保存先。無ければ未設定のグループになる。 */
  | { type: "ADD_GROUP"; id: string; name: string; category?: string }
  | { type: "RENAME_GROUP"; id: string; name: string }
  /** カテゴリは名前そのものが目印。まだ誰も使っていないカテゴリを 1 つ登録する。 */
  | { type: "ADD_CATEGORY"; name: string }
  /** そのカテゴリのテンプレートとグループ（中身ごと）を消し、レジストリからも外す。 */
  | { type: "DELETE_CATEGORY"; name: string }
  /** `to` が既存と重なると 1 つにまとまる。 */
  | { type: "RENAME_CATEGORY"; from: string; to: string }
  /** `category: null` で「未設定」に戻す。 */
  | { type: "SET_CATEGORY"; id: string; category: string | null }
  /** `category: null` でグループを「未設定」に戻す。 */
  | { type: "SET_GROUP_CATEGORY"; id: string; category: string | null }
  /** Deletes the group and the templates inside it. */
  | { type: "DELETE_GROUP"; id: string }
  /** Writes one group, with its templates, as one file. */
  | { type: "EXPORT_GROUP"; id: string }
  /** Folds or unfolds the group; the choice is remembered per group. */
  | { type: "TOGGLE_GROUP"; id: string; collapsed: boolean }
  /**
   * `groupId: null` targets the root. `index` counts the dragged node itself.
   * `category` があればテンプレートのカテゴリも書き換える（null が未設定、キー無しは変えない）。
   */
  | {
      type: "MOVE";
      nodeId: string;
      groupId: string | null;
      index: number;
      category?: string | null;
    }
  /** 一覧の見た目だけを切り替える。並び順やグループには影響しない。 */
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "RESIZE_UI"; height: number }
  /** 「共有カテゴリを追加」で入力中の（まだ追加していない）保存先で確かめる。 */
  | { type: "STORAGE_TEST"; source: SourceConfig | null }
  /**
   * UI でカテゴリを切り替えた。共有カテゴリならその保存先の一覧を、
   * それ以外はローカルの一覧を返す（保存先が変わらなければ何も返さない）。
   */
  | { type: "VIEW_CATEGORY"; category: string }
  /** 共有カテゴリを足す。`name` が空なら保存先の名前を使う。 */
  | { type: "ADD_LINKED_CATEGORY"; name: string; source: SourceConfig };

export type PluginToUiMessage =
  | {
      type: "TEMPLATES";
      templates: TemplateMeta[];
      /** List order and groups; reconciled against `templates` before sending. */
      tree: ListNode[];
      /** 一覧の見た目。UI ごとの好みなので、読み込み時に返す。 */
      viewMode: ViewMode;
      /** 登録済みのカテゴリ（まだ誰も使っていないものも含む）。表示順。共有カテゴリも入る。 */
      categories: string[];
      /** 共有カテゴリ（外部の保存先に中身があるカテゴリ）。 */
      linked: LinkedCategoryInfo[];
      usedBytes: number;
      /** 上限の無い保存先（R2）は null。 */
      quotaBytes: number | null;
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
  | { type: "ERROR"; message: string }
  | { type: "STORAGE_TEST_RESULT"; ok: boolean; message: string }
  /** 共有カテゴリを足した結果。成功なら `name` が決まった名前。 */
  | { type: "LINKED_CATEGORY_RESULT"; ok: boolean; name?: string; message?: string }
  /** 共有カテゴリの保存先に届かない。`category` はそのカテゴリ名。 */
  | { type: "STORAGE_ERROR"; kind: StorageErrorKind; message: string; category?: string };
