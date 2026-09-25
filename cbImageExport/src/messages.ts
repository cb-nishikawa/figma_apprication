import type {
  ExportConfig,
  ExportConstraint,
  ExportOptions,
  ExportRequest,
  ExportResultItem,
  FrameTarget,
  ImageListItem,
  RecentFrame,
} from "./types";

export type UiToPluginMessage =
  | { type: "LIST_FRAME_TARGETS" }
  | { type: "SET_FRAME_FROM_SELECTION" }
  | { type: "SET_FRAME_NODE"; nodeId: string | null }
  | { type: "SCAN_TARGET" }
  | { type: "FOCUS_NODE"; nodeId: string }
  | { type: "RENAME_NODE"; nodeId: string; name: string }
  | { type: "SET_EXPORT_SETTINGS"; nodeId: string; configs: ExportConfig[] }
  | { type: "HOVER_ROW"; nodeId: string | null }
  | { type: "EXPORT_NODES"; items: ExportRequest[] }
  | { type: "RESIZE_UI"; height: number }
  | { type: "SET_ASSET_URL_CONFIG"; nodeId: string | null; path: string }
  | {
      type: "FETCH_SVG_CODE";
      nodeId: string;
      constraint: ExportConstraint;
      options: ExportOptions;
    };

export type PluginToUiMessage =
  | {
      type: "FRAME_TARGETS";
      targets: FrameTarget[];
      targetId: string | null;
      /** 過去に選択した対象フレームの履歴（最大 20 件・直近が先頭）。 */
      recent: RecentFrame[];
      /** 現在の対象フレームの書き出し先パス（未設定は空文字）。 */
      assetUrlPath: string;
    }
  | { type: "IMAGE_LIST"; items: ImageListItem[]; message?: string }
  | { type: "SELECTION_EMPTY" }
  | { type: "EXPORT_RESULT"; results: ExportResultItem[] }
  | { type: "ERROR"; message: string }
  | { type: "ASSET_URL_CONFIG"; nodeId: string | null; path: string }
  | {
      type: "SVG_CODE";
      nodeId: string;
      svg: string;
      /** true のとき svg は空で、message がエラー内容。 */
      message?: string;
    };