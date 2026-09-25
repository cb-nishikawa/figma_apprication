export type ExportFormat = "PNG" | "JPG" | "SVG" | "PDF" | "WEBP" | "AVIF";

export const EXPORT_FORMATS: ExportFormat[] = [
  "PNG",
  "JPG",
  "SVG",
  "PDF",
  "WEBP",
  "AVIF",
];

export type FrameTargetKind = "SECTION" | "FRAME" | "INSTANCE" | "GROUP";

/** Selectable target frame shown in the scope picker (cbTextChecker style). */
export interface FrameTarget {
  id: string;
  name: string;
  kind: FrameTargetKind;
  label: string;
}

/** One list row: a visible image source node. */
export interface ImageListItem {
  id: string;
  name: string;
  /** Small PNG preview (optional; may be omitted on error). */
  thumbBytes?: number[];
  /** レイヤーのエクスポート設定から読み取った書き出し設定（空なら未設定）。 */
  exportConfigs?: ExportConfig[];
}

/** 書き出し単位の設定（形式 + サイズ指定）。 */
export type ExportConstraintType = "SCALE" | "WIDTH" | "HEIGHT";

/** 書き出しサイズ。SCALE = 倍率、WIDTH = 固定幅 px、HEIGHT = 固定高さ px。 */
export interface ExportConstraint {
  type: ExportConstraintType;
  value: number;
}

export const DEFAULT_EXPORT_CONSTRAINT: ExportConstraint = {
  type: "SCALE",
  value: 1,
};

/** 圧縮率の既定値（%）。PNG / JPG / WEBP / AVIF に適用。 */
export const DEFAULT_QUALITY = 92;

export interface ExportConfig {
  format: ExportFormat;
  constraint: ExportConstraint;
  /** 圧縮率（%・1〜100）。SVG / PDF では使用しない。 */
  quality?: number;
}

/**
 * チェック項目の書き出し除外設定（行ごと）。RBはデフォルトオン＝除外。
 * 書き出し時に対象プロパティを除去したクローンを一時使用するため、
 * 元レイヤー（exportSettings / 見た目）には影響しない。
 */
export interface ExportOptions {
  /** true の場合、行ノードのエフェクトを書き出しに含めない。 */
  excludeEffects: boolean;
  /** true の場合、行ノードの角丸を書き出しに含めない。 */
  excludeCornerRadius: boolean;
  /** true の場合、行ノードの線（strokes）を書き出しに含めない。 */
  excludeStrokes: boolean;
}

export const DEFAULT_EXCLUDE_OPTIONS: ExportOptions = {
  excludeEffects: true,
  excludeCornerRadius: true,
  excludeStrokes: true,
};

export interface ExportRequest {
  id: string;
  format: ExportFormat;
  constraint: ExportConstraint;
  options: ExportOptions;
}

export interface ExportResultItem {
  id: string;
  name: string;
  format: ExportFormat;
  /** この結果を書き出したサイズ指定（ファイル名のサフィックスに利用）。 */
  constraint: ExportConstraint;
  ok: boolean;
  message?: string;
  bytes?: number[];
}
