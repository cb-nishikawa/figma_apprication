export type ExportFormat = "PNG" | "JPG" | "SVG" | "PDF";

export const EXPORT_FORMATS: ExportFormat[] = ["PNG", "JPG", "SVG", "PDF"];

/** One list row: a visible image source node. */
export interface ImageListItem {
  id: string;
  name: string;
  /** Direct parent node's name. */
  parentName: string;
  /** Small PNG preview (optional; may be omitted on error). */
  thumbBytes?: number[];
}

export interface ExportRequest {
  id: string;
  format: ExportFormat;
  /** 書き出し倍率。1 = 等倍。ラスター形式（PNG/JPG）のみ有効。 */
  scale: number;
}

export interface ExportResultItem {
  id: string;
  name: string;
  format: ExportFormat;
  ok: boolean;
  message?: string;
  bytes?: number[];
}
