/** 2x3 affine matrix in Figma's `Transform` layout. */
export type Matrix = [[number, number, number], [number, number, number]];

export type SerializedNodeType =
  | "FRAME"
  | "GROUP"
  | "SECTION"
  | "RECTANGLE"
  | "ELLIPSE"
  | "POLYGON"
  | "STAR"
  | "LINE"
  | "VECTOR"
  | "BOOLEAN_OPERATION"
  | "TEXT"
  /** The following four only appear in component templates. */
  | "COMPONENT"
  | "COMPONENT_SET"
  | "INSTANCE"
  | "SLOT";

export interface SerializedTextSegment {
  start: number;
  end: number;
  fontName: { family: string; style: string };
  fontSize: number;
  fills: unknown[];
  textDecoration: string;
  textCase: string;
  lineHeight: unknown;
  letterSpacing: unknown;
  hyperlink: unknown;
}

export interface SerializedText {
  characters: string;
  segments: SerializedTextSegment[];
}

/** Points at a main component (or a variant inside a component set). */
export interface SerializedComponentRef {
  key: string;
  id: string;
  /** True when the component comes from a published library. */
  remote: boolean;
  setKey?: string;
  setId?: string;
  /** Variant name inside the set, e.g. `Size=Large, State=Hover`. */
  variantName?: string;
}

export interface SerializedPropertyDefinition {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "VARIANT" | "SLOT";
  defaultValue: string | boolean;
  variantOptions?: string[];
  preferredValues?: Array<{ type: "COMPONENT" | "COMPONENT_SET"; key: string }>;
  description?: string;
  slotSettings?: Record<string, unknown>;
  /** INSTANCE_SWAP: the default component (`defaultValue` is a file-local id). */
  defaultRef?: SerializedComponentRef;
}

export interface SerializedComponentProps {
  description: string;
  /** Property name (with `#id` suffix) -> definition. */
  definitions: Record<string, SerializedPropertyDefinition>;
}

export interface SerializedInstance extends SerializedComponentRef {
  /** Non-SLOT component property values. */
  properties: Record<string, string | boolean>;
  /** INSTANCE_SWAP property name -> swapped-in component. */
  swapRefs?: Record<string, SerializedComponentRef>;
}

export interface SerializedNode {
  type: SerializedNodeType;
  /** Original node type (e.g. INSTANCE restored as FRAME). */
  sourceType: string;
  /** Absolute transform relative to the template's top-left origin. */
  transform: Matrix;
  width: number;
  height: number;
  /** Plain settable properties (paints, strokes, layout, …). */
  props: Record<string, unknown>;
  /** Auto-layout properties applied after children are appended. */
  layout?: Record<string, unknown>;
  /** Properties that only make sense once the node sits in its parent. */
  childLayout?: Record<string, unknown>;
  text?: SerializedText;
  vectorNetwork?: unknown;
  vectorPaths?: unknown;
  booleanOperation?: string;
  /** COMPONENT (non-variant) and COMPONENT_SET only. */
  componentProps?: SerializedComponentProps;
  /** `componentPropertyReferences` of a component sublayer. */
  propertyRefs?: Record<string, string>;
  /** INSTANCE only. Children are still stored for overrides and the detached fallback. */
  instance?: SerializedInstance;
  /** Fields overridden on this node inside an instance. */
  overriddenFields?: string[];
  children?: SerializedNode[];
}

export type TemplateKind = "layout" | "component";

export interface TemplateMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: number;
  byteSize: number;
  nodeCount: number;
  /** data:image/jpeg;base64,… (older templates: PNG) */
  thumbnail: string;
  /** 2 = rendered from the restored template; older thumbnails are regenerated on startup. */
  thumbnailVersion?: number;
  /** Missing means "layout". */
  kind?: TemplateKind;
  /** Component templates: the original node, used to clone it within the same file. */
  source?: { nodeId: string; stamp: string };
  /**
   * Component templates: how the image paints in `source` are treated when the
   * template is placed again. Absent means "placeholder".
   */
  imageMode?: ImageMode;
  /**
   * カテゴリの名前。無い（または空文字）は「未設定」。
   * グループは一覧の並びの容器なので、カテゴリはそれとは別物のラベル。
   */
  category?: string;
}

/**
 * 保存時の「画像を含めるか」の選択。
 * - `keep`: 画像バイト列を保存し、復元・複製では画像をそのまま使う
 * - `placeholder`: 画像部分を `frame("image") > text("image")` _NONE_ に置き換える
 */
export type ImageMode = "keep" | "placeholder";

/** Decoded template body used when restoring. */
export interface TemplateContent {
  roots: SerializedNode[];
  /** Embedded main components that are not in a published library, keyed by component (or set) key. */
  components?: Record<string, SerializedNode>;
  /**
   * `imageHash` -> 画像バイト列。保存時に「画像を含める」を選んだときだけ入る。
   * 無い（あるいは hash 不一致）場合は画像塗りを単色のプレースホルダに戻す。
   */
  images?: Record<string, Uint8Array>;
}

export interface StoredTemplateV1 {
  version: 1;
  roots: SerializedNode[];
  /** Saved image bytes; ignored because image paints are restored as solid fills. */
  images: Record<string, Uint8Array>;
}

export interface StoredTemplateV2 {
  version: 2;
  /** gzip of JSON `{ roots, components? }`. */
  data: Uint8Array;
}

export interface StoredTemplateV3 {
  version: 3;
  /** gzip of JSON `{ roots, components? }`. */
  data: Uint8Array;
  /** `imageHash` -> 画像バイト列。JSON には入れず別枠で持つ。 */
  images?: Record<string, Uint8Array>;
}

export type TemplateItem = StoredTemplateV1 | StoredTemplateV2 | StoredTemplateV3;

/** A folder in the list. Groups hold templates only, so they never nest. */
export interface TemplateGroup {
  type: "group";
  id: string;
  name: string;
  /** Group category label. Missing means "未設定". */
  category?: string;
  /** Template ids inside, in display order. */
  items: string[];
  /**
   * Whether the group is folded. Absent means open, so trees written before
   * groups could collapse keep working. Never exported: the file carries the
   * contents and the order, not how the sender had their list folded.
   */
  collapsed?: boolean;
}

/** A template placed at the root of the list. */
export interface TemplateListEntry {
  type: "item";
  id: string;
}

export type ListNode = TemplateGroup | TemplateListEntry;

/**
 * 一覧の見た目。`detail` が既定の従来の行、`list` はサムネイルと名前のみ、
 * `grid` はそれを 2 カラムにして画像を大きくする。
 */
export type ViewMode = "detail" | "list" | "grid";

export const VIEW_MODES: ViewMode[] = ["detail", "list", "grid"];

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && (VIEW_MODES as string[]).includes(value);
}

/**
 * 読み込み方の 3 択。
 * - `replace`: 既存のテンプレートとグループをすべて消して、ファイルの並び通りにする
 * - `append`: そのまま残し、末尾に並べる
 * - `category`: `append` と同じで、全件を「追加されたカテゴリ」に入れる
 */
export type ImportMode = "replace" | "append" | "category";

export const IMPORT_MODES: ImportMode[] = ["replace", "append", "category"];

export function isImportMode(value: unknown): value is ImportMode {
  return typeof value === "string" && (IMPORT_MODES as string[]).includes(value);
}

/** 「カテゴリにして追加」で作るカテゴリの名前。もうあれば同じものとして扱う。 */
export const IMPORT_CATEGORY_NAME = "追加されたカテゴリ";

/** 一覧に出すカテゴリ。`category` が無いテンプレートはこれに入る。 */
export const NO_CATEGORY = "未設定";

export const TEMPLATE_FILE_FORMAT = "cbTemplatePalette";

export interface TemplateFile {
  format: typeof TEMPLATE_FILE_FORMAT;
  /** 4 adds `templates[].images`; 3 adds `tree`; version 2 files are read as a flat list at the root. */
  version: 2 | 3 | 4;
  /** Only in version 3+. Ids refer to `templates[].meta.id`. */
  tree?: ListNode[];
  templates: Array<{
    meta: TemplateMeta;
    roots: SerializedNode[];
    components?: Record<string, SerializedNode>;
    /** Only in version 4. `imageHash` -> `data:image/...;base64,…` */
    images?: Record<string, string>;
  }>;
}

export interface SerializeReport {
  skipped: number;
  nodeCount: number;
}

export interface RestoreReport {
  replacedFonts: string[];
  failedProps: number;
  /** Image paints replaced with a solid placeholder. */
  replacedImages: number;
  /** Main components recreated from embedded definitions. */
  createdComponents: number;
  /** Instances built as frames because their main component was unavailable. */
  detachedInstances: number;
  failedComponentProps: number;
}
