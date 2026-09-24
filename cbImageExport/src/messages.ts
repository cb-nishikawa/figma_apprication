import type {
  ExportRequest,
  ExportResultItem,
  ImageListItem,
} from "./types";

export type UiToPluginMessage =
  | { type: "SCAN_SELECTION" }
  | { type: "FOCUS_NODE"; nodeId: string }
  | { type: "EXPORT_NODES"; items: ExportRequest[] }
  | { type: "RESIZE_UI"; height: number };

export type PluginToUiMessage =
  | {
      type: "IMAGE_LIST";
      items: ImageListItem[];
      frameNames: string[];
      message?: string;
    }
  | { type: "EXPORT_RESULT"; results: ExportResultItem[] }
  | { type: "ERROR"; message: string };
