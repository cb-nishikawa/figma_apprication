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
}

/** Decoded template body used when restoring. */
export interface TemplateContent {
  roots: SerializedNode[];
  /** Embedded main components that are not in a published library, keyed by component (or set) key. */
  components?: Record<string, SerializedNode>;
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

export type TemplateItem = StoredTemplateV1 | StoredTemplateV2;

export const TEMPLATE_FILE_FORMAT = "cbTemplatePalette";

export interface TemplateFile {
  format: typeof TEMPLATE_FILE_FORMAT;
  version: 2;
  templates: Array<{
    meta: TemplateMeta;
    roots: SerializedNode[];
    components?: Record<string, SerializedNode>;
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
