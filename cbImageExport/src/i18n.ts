export type Locale = "ja" | "en";

export const LOCALES: Locale[] = ["ja", "en"];

const ja = {
  pluginName: "画像一括書き出しくん",

  // ターゲット行・メニュー
  targetEmpty: "フレーム未選択",
  targetAria: "対象フレーム",
  targetNoCandidates: "候補がありません",
  targetNoMatch: "該当なし",
  applyTargetFromSelection: "キャンバスで選択中のフレームを対象にする",
  rescan: "再読み込み",
  menu: "メニュー",

  // タブ・見出し
  tabLayers: "レイヤー",
  tabExport: "エクスポート",
  selectedLayers: "選択中のレイヤー",
  imageList: "画像一覧",
  selectAll: "すべて",
  exportAll: "書き出し",
  resizeHandle: "高さをドラッグで調整",

  // 行
  selectLayerPrompt: "レイヤーを選択してください",
  outsideTarget: "ターゲット外のレイヤーです",
  noImages: "画像がありません",
  exportEmpty:
    "書き出し設定のあるレイヤーはまだありません（画像一覧・選択中のレイヤーの「+」で追加）",
  layerName: "レイヤー名",
  exportFormat: "書き出し形式",
  exportSize: "書き出しサイズ",
  exportSizeHint: "倍率・寸法: 1x / 2x / 0.5x / 512w / 512h",
  addFormat: "書き出し形式を追加",
  exportRow: "この行を書き出し",
  removeFormat: "この書き出し形式を削除",
  quality: "圧縮率",
  qualityHint: "圧縮率（%）",

  // 除外メニュー
  excludeTitle: "チェック項目を除外する",
  excludeEffects: "エフェクト",
  excludeStrokes: "線",
  excludeCornerRadius: "角丸",
  excludeItem: "{label}を除外する",

  // コピーメニュー・URL 設定
  copyUrl: "urlをコピー",
  copySvgCode: "埋め込みコードをコピー",
  copyDataUri: "Data URI をコピー",
  copied: "コピーしました",
  copyFailed: "コピーに失敗",
  loading: "読み込み中…",
  assetUrlSettings: "URL コピー設定",
  assetUrlPath: "書き出し先パス",

  // 書き出し
  exporting: "書き出し中…",
  exportFailed: "書き出しに失敗しました",
  exportFailedDetail: "書き出しに失敗: {message}",
  exportFailedCount: "{count} 件の書き出しに失敗しました",
  saveFailed: "保存に失敗: {message}",
  noExportConfigs: "書き出し設定がありません",
  checkExportItems: "エクスポートの項目にチェックを入れてください",

  // 画像変換（UI 側）
  canvasUnavailable: "canvas 2D を取得できません",
  convertFailed: "画像変換に失敗しました",
  convertUnexpectedType:
    "画像変換の出力形式が想定と異なります（{type}）。対応していない形式です",
  unknown: "不明",
  avifEncodeFailed: "AVIF エンコードに失敗しました（出力形式の検証に失敗）",

  // プラグイン側から送るメッセージ
  selectTargetFrame: "対象フレームを選択してください",
  targetNotFound: "対象フレームが見つかりません",
  noImagesFound:
    "表示中の画像やエクスポート設定のあるレイヤーが見つかりませんでした",
  nodeNotExportable: "ノードが見つからないか書き出せません",
  formatExportFailed: "{format} 書き出しに失敗: {message}",
  emptySvg: "空の SVG が返されました",
  svgExportFailed: "SVG 書き出しに失敗: {message}",
  emptyImageData: "空の画像データが返されました",
  imageDataFailed: "画像データの取得に失敗: {message}",
  cannotResolveTarget: "選択から対象フレームを解決できません",
};

export type MessageKey = keyof typeof ja;

const en: Record<MessageKey, string> = {
  pluginName: "Mr. Bulk Image Exporter",

  targetEmpty: "No frame selected",
  targetAria: "Target frame",
  targetNoCandidates: "No candidates",
  targetNoMatch: "No matches",
  applyTargetFromSelection: "Use the frame selected on the canvas",
  rescan: "Reload",
  menu: "Menu",

  tabLayers: "Layers",
  tabExport: "Export",
  selectedLayers: "Selected layers",
  imageList: "Images",
  selectAll: "All",
  exportAll: "Export",
  resizeHandle: "Drag to resize",

  selectLayerPrompt: "Select a layer",
  outsideTarget: "This layer is outside the target",
  noImages: "No images",
  exportEmpty:
    "No layers with export settings yet (add them with \"+\" in Images or Selected layers)",
  layerName: "Layer name",
  exportFormat: "Export format",
  exportSize: "Export size",
  exportSizeHint: "Scale / size: 1x / 2x / 0.5x / 512w / 512h",
  addFormat: "Add export format",
  exportRow: "Export this row",
  removeFormat: "Remove this export format",
  quality: "Quality",
  qualityHint: "Quality (%)",

  excludeTitle: "Exclude from export",
  excludeEffects: "Effects",
  excludeStrokes: "Strokes",
  excludeCornerRadius: "Corner radius",
  excludeItem: "Exclude {label}",

  copyUrl: "Copy URL",
  copySvgCode: "Copy embed code",
  copyDataUri: "Copy Data URI",
  copied: "Copied",
  copyFailed: "Copy failed",
  loading: "Loading…",
  assetUrlSettings: "URL copy settings",
  assetUrlPath: "Export path",

  exporting: "Exporting…",
  exportFailed: "Export failed",
  exportFailedDetail: "Export failed: {message}",
  exportFailedCount: "{count} exports failed",
  saveFailed: "Save failed: {message}",
  noExportConfigs: "No export settings",
  checkExportItems: "Check the items you want to export",

  canvasUnavailable: "Could not get a 2D canvas",
  convertFailed: "Image conversion failed",
  convertUnexpectedType:
    "Unexpected output format from image conversion ({type}). This format is not supported",
  unknown: "unknown",
  avifEncodeFailed: "AVIF encoding failed (output format check failed)",

  selectTargetFrame: "Select a target frame",
  targetNotFound: "Target frame not found",
  noImagesFound: "No visible images or layers with export settings were found",
  nodeNotExportable: "Node not found or cannot be exported",
  formatExportFailed: "{format} export failed: {message}",
  emptySvg: "An empty SVG was returned",
  svgExportFailed: "SVG export failed: {message}",
  emptyImageData: "Empty image data was returned",
  imageDataFailed: "Failed to get image data: {message}",
  cannotResolveTarget: "Could not resolve a target frame from the selection",
};

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { ja, en };

let currentLocale: Locale = "ja";

export function isLocale(value: unknown): value is Locale {
  return value === "ja" || value === "en";
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const template = MESSAGES[currentLocale][key] ?? MESSAGES.ja[key];
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}
