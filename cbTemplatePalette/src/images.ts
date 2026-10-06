import type { Matrix, SerializedNode, SerializedText } from "./types";

/** 「画像を含めない」とき、画像ノードの代わりに置く frame / text の名前。 */
export const IMAGE_PLACEHOLDER_NAME = "image";
export const IMAGE_PLACEHOLDER_TEXT = "image";

/**
 * 画像「線」やベクター領域など、構造を保ったまま単色へ落とすときの塗り。
 * 復元側の既定の画像プレースホルダと同じ色。
 */
export const IMAGE_SOLID: RGB = { r: 0xd9 / 255, g: 0xd9 / 255, b: 0xd9 / 255 };
/** プレースホルダ frame の枠線。 */
export const IMAGE_BORDER: RGB = { r: 0xc4 / 255, g: 0xc4 / 255, b: 0xc4 / 255 };
/** プレースホルダ frame の中に置く文字の色。 */
export const IMAGE_LABEL: RGB = { r: 0x8a / 255, g: 0x8a / 255, b: 0x8a / 255 };
export const IMAGE_LABEL_FONT = { family: "Inter", style: "Regular" };
export const IMAGE_LABEL_SIZE = 12;

export function isImagePaint(paint: unknown): boolean {
  return (
    !!paint &&
    typeof paint === "object" &&
    (paint as { type?: unknown }).type === "IMAGE" &&
    typeof (paint as { imageHash?: unknown }).imageHash === "string"
  );
}

export function hasImagePaint(paints: unknown): boolean {
  return Array.isArray(paints) && paints.some(isImagePaint);
}

/** 画像塗りを、元の不透明度を引き継いだ単色へ変える。 */
export function solidFor(paint: unknown): Record<string, unknown> {
  const source = (paint ?? {}) as { opacity?: unknown; visible?: unknown; blendMode?: unknown };
  return {
    type: "SOLID",
    color: IMAGE_SOLID,
    opacity: typeof source.opacity === "number" ? source.opacity : 1,
    visible: typeof source.visible === "boolean" ? source.visible : true,
    blendMode: typeof source.blendMode === "string" ? source.blendMode : "NORMAL",
  };
}

export function solidPaints(paints: unknown): unknown[] {
  return Array.isArray(paints) ? paints.map((paint) => (isImagePaint(paint) ? solidFor(paint) : paint)) : [];
}

export function countImagePaints(paints: unknown): number {
  return Array.isArray(paints) ? paints.filter(isImagePaint).length : 0;
}

export function borderStroke(): Record<string, unknown> {
  return { type: "SOLID", color: IMAGE_BORDER, opacity: 1, visible: true, blendMode: "NORMAL" };
}

export function labelFills(): Record<string, unknown> {
  return { type: "SOLID", color: IMAGE_LABEL, opacity: 1, visible: true, blendMode: "NORMAL" };
}

function identityMatrix(): Matrix {
  return [
    [1, 0, 0],
    [0, 1, 0],
  ];
}

/** `fills` / `strokes` / 文字の途中の塗り / ベクター領域の塗りにある画像ハッシュ。 */
function eachImagePaint(node: SerializedNode, visit: (paint: Record<string, unknown>) => void): void {
  for (const key of ["fills", "strokes"] as const) {
    const paints = node.props[key];
    if (Array.isArray(paints)) {
      for (const paint of paints) {
        if (isImagePaint(paint)) {
          visit(paint as Record<string, unknown>);
        }
      }
    }
  }
  for (const segment of node.text?.segments ?? []) {
    for (const paint of segment.fills ?? []) {
      if (isImagePaint(paint)) {
        visit(paint as Record<string, unknown>);
      }
    }
  }
  const regions = (node.vectorNetwork as { regions?: Array<{ fills?: unknown }> })?.regions;
  if (Array.isArray(regions)) {
    for (const region of regions) {
      for (const paint of Array.isArray(region.fills) ? region.fills : []) {
        if (isImagePaint(paint)) {
          visit(paint as Record<string, unknown>);
        }
      }
    }
  }
  for (const child of node.children ?? []) {
    eachImagePaint(child, visit);
  }
}

/** 保存対象の画像ハッシュ（重複なし）。容量の見積り・バイト列の取り出しに使う。 */
export function collectImageHashes(roots: readonly SerializedNode[]): string[] {
  const hashes = new Set<string>();
  for (const root of roots) {
    eachImagePaint(root, (paint) => hashes.add(paint.imageHash as string));
  }
  return [...hashes];
}

/** Figma が読み込める形式を先頭バイトから当てる（書き出しのラベル用）。 */
function imageMime(bytes: Uint8Array): string {
  const [a, b, c, d] = bytes;
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) {
    return "image/png";
  }
  if (a === 0xff && b === 0xd8 && c === 0xff) {
    return "image/jpeg";
  }
  if (a === 0x47 && b === 0x49 && c === 0x46) {
    return "image/gif";
  }
  if (a === 0x52 && b === 0x49 && c === 0x46 && d === 0x46) {
    return "image/webp";
  }
  for (const head of ["<svg", "<?xml", "<!DOCTYPE"]) {
    if (startsWithAscii(bytes, head)) {
      return "image/svg+xml";
    }
  }
  return "image/png";
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

/** ファイル書き出し用: バイト列を `data:…;base64,…` にする。 */
export function encodeImages(
  images: Record<string, Uint8Array> | undefined
): Record<string, string> | undefined {
  if (!images) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [hash, bytes] of Object.entries(images)) {
    if (bytes.byteLength > 0) {
      out[hash] = `data:${imageMime(bytes)};base64,${figma.base64Encode(bytes)}`;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** ファイル読み込み用: `data:…;base64,…` をバイト列へ戻す。読めないものは捨てる。 */
export function decodeImages(value: unknown): Record<string, Uint8Array> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, Uint8Array> = {};
  for (const [hash, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") {
      continue;
    }
    const comma = raw.indexOf(",");
    try {
      const bytes = figma.base64Decode(comma >= 0 ? raw.slice(comma + 1) : raw);
      if (hash && bytes.byteLength > 0) {
        out[hash] = bytes;
      }
    } catch {
      // 読めない画像は入れない。復元時に単色のプレースホルダへ戻る。
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function solidifyText(text: SerializedText, report: ImageRewriteReport): SerializedText {
  return {
    ...text,
    segments: text.segments.map((segment) => {
      report.replaced += countImagePaints(segment.fills);
      return { ...segment, fills: solidPaints(segment.fills) };
    }),
  };
}

function solidifyNetwork(network: unknown, report: ImageRewriteReport): unknown {
  const value = network as { regions?: Array<{ fills?: unknown }> };
  if (!Array.isArray(value?.regions)) {
    return network;
  }
  return {
    ...value,
    regions: value.regions.map((region) => {
      if (!Array.isArray(region.fills)) {
        return region;
      }
      report.replaced += countImagePaints(region.fills);
      return { ...region, fills: solidPaints(region.fills) };
    }),
  };
}

function placeholderLabel(): SerializedNode {
  const fills = [labelFills()];
  return {
    type: "TEXT",
    sourceType: "TEXT",
    transform: identityMatrix(),
    width: 34,
    height: 16,
    props: {
      name: IMAGE_PLACEHOLDER_NAME,
      fills,
      textAlignHorizontal: "CENTER",
      textAlignVertical: "CENTER",
      textAutoResize: "WIDTH_AND_HEIGHT",
    },
    text: {
      characters: IMAGE_PLACEHOLDER_TEXT,
      segments: [
        {
          start: 0,
          end: IMAGE_PLACEHOLDER_TEXT.length,
          fontName: IMAGE_LABEL_FONT,
          fontSize: IMAGE_LABEL_SIZE,
          fills,
          textDecoration: "NONE",
          textCase: "ORIGINAL",
          lineHeight: { unit: "AUTO" },
          letterSpacing: { unit: "PERCENT", value: 0 },
          hyperlink: null,
        },
      ],
    },
  };
}

/** 枠線だけの frame の中に文字を中央へ置くための自動レイアウト。 */
function centerLayout(): Record<string, unknown> {
  return {
    layoutMode: "VERTICAL",
    layoutWrap: "NO_WRAP",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
  };
}

const CARRIED_PROPS = [
  "opacity",
  "visible",
  "blendMode",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
] as const;

/**
 * 画像塗りを持つノードを `frame("image")` へ包む。大きさ・位置・角丸・不透明度は
 * 引き継ぎ、塗りではなく 1px の枠線だけを持つ。
 */
function wrapInPlaceholder(source: SerializedNode, inner: SerializedNode[]): SerializedNode {
  const props: Record<string, unknown> = {
    name: IMAGE_PLACEHOLDER_NAME,
    fills: [],
    strokes: [borderStroke()],
    strokeWeight: 1,
    strokeAlign: "INSIDE",
  };
  for (const key of CARRIED_PROPS) {
    if (source.props[key] !== undefined) {
      props[key] = source.props[key];
    }
  }
  return {
    type: "FRAME",
    sourceType: "FRAME",
    transform: source.transform,
    width: source.width,
    height: source.height,
    props,
    children: inner,
  };
}

interface ImageRewriteReport {
  replaced: number;
}

/** 塗りから画像だけを取り除く（他の塗りは残す）。 */
function withoutImageFills(props: Record<string, unknown>): Record<string, unknown> {
  const fills = props.fills;
  if (!Array.isArray(fills)) {
    return { ...props };
  }
  return { ...props, fills: fills.filter((paint) => !isImagePaint(paint)) };
}

function rewriteNode(node: SerializedNode, report: ImageRewriteReport): SerializedNode {
  const next: SerializedNode = { ...node, props: { ...node.props } };
  if (node.children) {
    next.children = node.children.map((child) => rewriteNode(child, report));
  }
  if (node.text) {
    next.text = solidifyText(node.text, report);
  }
  if (node.vectorNetwork) {
    next.vectorNetwork = solidifyNetwork(node.vectorNetwork, report);
  }
  if (Array.isArray(next.props.strokes)) {
    report.replaced += countImagePaints(next.props.strokes);
    next.props.strokes = solidPaints(next.props.strokes);
  }
  if (!hasImagePaint(next.props.fills)) {
    return next;
  }

  report.replaced += 1;
  const children = next.children ?? [];
  if (children.length > 0 || next.type === "TEXT") {
    // 中身はそのまま残したいので、元のノードを枠線の中に入れる。
    // 枠線は自動レイアウトにせず、中身は絶対配置の位置をそのまま保つ。
    const inner: SerializedNode = {
      ...next,
      transform: identityMatrix(),
      props: withoutImageFills(next.props),
    };
    // 枠線の中では絶対配置になるため、親からの相対指定だけ外す。
    // 自動レイアウトは元のノードの中でそのまま働く。
    delete inner.childLayout;
    return wrapInPlaceholder(next, [inner]);
  }
  const frame = wrapInPlaceholder(next, [placeholderLabel()]);
  frame.layout = centerLayout();
  return frame;
}

/** 「画像を含めない」で保存したときの置換結果。 */
export interface ImageRewriteResult {
  roots: SerializedNode[];
  /** 画像塗りを枠線や単色へ置き換えた数。 */
  replaced: number;
}

/**
 * 保存時の「画像を含めない」をシリアライズ結果へ適用する。復元側はこのデータをそのまま
 * 使うので、サムネイル・複製・書き出しのすべてがこの見た目になる。
 */
export function withoutImagePaints(roots: readonly SerializedNode[]): ImageRewriteResult {
  const report: ImageRewriteReport = { replaced: 0 };
  return { roots: roots.map((root) => rewriteNode(root, report)), replaced: report.replaced };
}

/**
 * 埋め込みコンポーネントにも同じ置換をかける。`keep` のときはそのまま返す。
 * 件数（`replaced`）は呼び出し側が关心的でないため返さない。
 */
export function withoutImagePaintsIn(
  components: Record<string, SerializedNode> | undefined,
  keep: boolean
): Record<string, SerializedNode> | undefined {
  if (!components || Object.keys(components).length === 0 || keep) {
    return components;
  }
  const keys = Object.keys(components);
  const rewritten = withoutImagePaints(Object.values(components)).roots;
  const out: Record<string, SerializedNode> = {};
  keys.forEach((key, index) => {
    out[key] = rewritten[index];
  });
  return out;
}
