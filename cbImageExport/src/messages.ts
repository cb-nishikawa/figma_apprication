import type {
  ExportConfig,
  ExportRequest,
  ExportResultItem,
  FrameTarget,
  ImageListItem,
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
  | { type: "RESIZE_UI"; height: number };

export type PluginToUiMessage =
  | {
      type: "FRAME_TARGETS";
      targets: FrameTarget[];
      targetId: string | null;
    }
  | { type: "IMAGE_LIST"; items: ImageListItem[]; message?: string }
  | { type: "SELECTION_EMPTY" }
  | { type: "EXPORT_RESULT"; results: ExportResultItem[] }
  | { type: "ERROR"; message: string };