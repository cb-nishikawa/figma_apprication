export type ExportFormat = "PNG" | "JPG" | "SVG" | "PDF";

export const EXPORT_FORMATS: ExportFormat[] = ["PNG", "JPG", "SVG", "PDF"];

/** One list row: resolved export target (mask parent / clip frame / image node). */
export interface ImageListItem {
  id: string;
  name: string;
  kind: "mask" | "clip" | "image";
  /** Small PNG preview (optional; may be omitted on error). */
  thumbBytes?: number[];
  frameName: string;
}

export interface ExportRequest {
  id: string;
  format: ExportFormat;
}

export interface ExportResultItem {
  id: string;
  name: string;
  format: ExportFormat;
  ok: boolean;
  message?: string;
  bytes?: number[];
}
