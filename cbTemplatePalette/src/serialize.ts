import type {
  Matrix,
  SerializeReport,
  SerializedComponentProps,
  SerializedComponentRef,
  SerializedInstance,
  SerializedNode,
  SerializedNodeType,
  SerializedPropertyDefinition,
  SerializedText,
} from "./types";

const BASE_PROPS = [
  "name",
  "visible",
  "opacity",
  "blendMode",
  "isMask",
  "maskType",
  "constraints",
  "exportSettings",
] as const;

const GEOMETRY_PROPS = [
  "fills",
  "strokes",
  "strokeWeight",
  "strokeTopWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "strokeRightWeight",
  "strokeAlign",
  "strokeCap",
  "strokeJoin",
  "strokeMiterLimit",
  "dashPattern",
  "effects",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "cornerSmoothing",
] as const;

const FRAME_PROPS = ["clipsContent", "layoutGrids"] as const;

const SHAPE_PROPS = ["arcData", "pointCount", "innerRadius"] as const;

const TEXT_PARAGRAPH_PROPS = [
  "textAlignHorizontal",
  "textAlignVertical",
  "paragraphSpacing",
  "paragraphIndent",
  "textAutoResize",
  "textTruncation",
  "maxLines",
] as const;

const LAYOUT_PROPS = [
  "layoutMode",
  "layoutWrap",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "itemSpacing",
  "counterAxisSpacing",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "counterAxisAlignContent",
  "itemReverseZIndex",
  "strokesIncludedInLayout",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
] as const;

const CHILD_LAYOUT_PROPS = [
  "layoutPositioning",
  "layoutAlign",
  "layoutGrow",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
] as const;

const FRAME_LIKE = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SLOT",
]);

/** Kept as their own type only in component templates. */
const COMPONENT_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE", "SLOT"]);

/** Serialized types that carry frame properties and auto layout. */
const CONTAINER_TYPES = new Set<SerializedNodeType>([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SLOT",
]);

const SHAPE_TYPES = new Set([
  "RECTANGLE",
  "ELLIPSE",
  "POLYGON",
  "STAR",
  "LINE",
  "VECTOR",
]);

/**
 * Top-level node types the save button accepts: containers plus every shape,
 * vector, boolean and text the serializer can round-trip. Types left out
 * (slices, connectors, widgets, embeds, tables and the like) cannot be rebuilt,
 * so a selection containing one is refused instead of quietly dropping it.
 */
const SAVABLE_ROOT_TYPES = new Set<string>([
  "FRAME",
  "SECTION",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  ...SHAPE_TYPES,
  "BOOLEAN_OPERATION",
  "TEXT",
]);

/** A single selected component or component set is saved as a component template. */
export function isComponentRoot(node: SceneNode): node is ComponentNode | ComponentSetNode {
  return node.type === "COMPONENT" || node.type === "COMPONENT_SET";
}

export function isSavableRoot(node: SceneNode): boolean {
  return SAVABLE_ROOT_TYPES.has(node.type);
}

/** Deep plain copy without variable bindings (they never resolve in another file). */
function toPlain(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "boundVariables") {
        continue;
      }
      out[key] = toPlain(entry);
    }
    return out;
  }
  return value;
}

function copyProps(
  node: SceneNode,
  keys: readonly string[],
  out: Record<string, unknown>
): void {
  const source = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in node)) {
      continue;
    }
    let value: unknown;
    try {
      value = source[key];
    } catch {
      continue;
    }
    if (value === figma.mixed || value === undefined) {
      continue;
    }
    out[key] = toPlain(value);
  }
}

function filterPaints(paints: unknown): unknown[] | undefined {
  if (!Array.isArray(paints)) {
    return undefined;
  }
  return (paints as Paint[]).filter((paint) => paint.type !== "VIDEO");
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2],
    ],
  ];
}

function translation(x: number, y: number): Matrix {
  return [
    [1, 0, x],
    [0, 1, y],
  ];
}

type SerializeMode = "layout" | "component";

function serializedType(node: SceneNode, mode: SerializeMode): SerializedNodeType | null {
  if (mode === "component" && COMPONENT_TYPES.has(node.type)) {
    return node.type as SerializedNodeType;
  }
  if (FRAME_LIKE.has(node.type)) {
    return "FRAME";
  }
  switch (node.type) {
    case "GROUP":
    case "SECTION":
    case "RECTANGLE":
    case "ELLIPSE":
    case "POLYGON":
    case "STAR":
    case "LINE":
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "TEXT":
      return node.type;
    default:
      return null;
  }
}

function serializeText(node: TextNode): SerializedText {
  const segments = node.getStyledTextSegments([
    "fontName",
    "fontSize",
    "fills",
    "textDecoration",
    "textCase",
    "lineHeight",
    "letterSpacing",
    "hyperlink",
  ]);
  return {
    characters: node.characters,
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      fontName: {
        family: segment.fontName.family,
        style: segment.fontName.style,
      },
      fontSize: segment.fontSize,
      fills: (toPlain(filterPaints(segment.fills)) as unknown[]) ?? [],
      textDecoration: segment.textDecoration,
      textCase: segment.textCase,
      lineHeight: toPlain(segment.lineHeight),
      letterSpacing: toPlain(segment.letterSpacing),
      hyperlink: toPlain(segment.hyperlink),
    })),
  };
}

interface SerializeContext {
  origin: Matrix;
  report: SerializeReport;
  mode: SerializeMode;
  /** False while serializing embedded definitions, which are not part of the template's own counts. */
  counting: boolean;
  /** Node id -> fields overridden inside an instance. */
  overrides: Map<string, string[]>;
  /** Embedded main components (component or set key -> definition). */
  components: Record<string, SerializedNode>;
  /** Keys already embedded or being embedded, including the template root. */
  embedded: Set<string>;
}

function readPropertyRefs(node: SceneNode): Record<string, string> | undefined {
  if (!("componentPropertyReferences" in node)) {
    return undefined;
  }
  let refs: Record<string, string> | null = null;
  try {
    refs = node.componentPropertyReferences as Record<string, string> | null;
  } catch {
    return undefined;
  }
  if (!refs) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(refs)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function embedDefinition(def: ComponentNode | ComponentSetNode, ctx: SerializeContext): Promise<void> {
  if (ctx.embedded.has(def.key)) {
    return;
  }
  ctx.embedded.add(def.key);
  const box = def.absoluteBoundingBox;
  if (!box) {
    return;
  }
  const serialized = await serializeNode(def, {
    ...ctx,
    origin: translation(-box.x, -box.y),
    counting: false,
  });
  if (serialized) {
    ctx.components[def.key] = serialized;
  }
}

async function refFromComponent(main: ComponentNode, ctx: SerializeContext): Promise<SerializedComponentRef> {
  const ref: SerializedComponentRef = { key: main.key, id: main.id, remote: main.remote };
  const parent = main.parent;
  if (parent && parent.type === "COMPONENT_SET") {
    ref.setKey = parent.key;
    ref.setId = parent.id;
    ref.variantName = main.name;
  }
  if (!main.remote) {
    await embedDefinition(parent && parent.type === "COMPONENT_SET" ? parent : main, ctx);
  }
  return ref;
}

async function refById(id: string, ctx: SerializeContext): Promise<SerializedComponentRef | undefined> {
  try {
    const node = await figma.getNodeByIdAsync(id);
    return node && node.type === "COMPONENT" ? await refFromComponent(node, ctx) : undefined;
  } catch {
    return undefined;
  }
}

async function serializeComponentProps(
  node: ComponentNode | ComponentSetNode,
  ctx: SerializeContext
): Promise<SerializedComponentProps> {
  let definitions: ComponentPropertyDefinitions = {};
  try {
    definitions = node.componentPropertyDefinitions;
  } catch {
    // Variants inside a set have no definitions of their own.
  }
  const out: Record<string, SerializedPropertyDefinition> = {};
  for (const [name, def] of Object.entries(definitions)) {
    const entry: SerializedPropertyDefinition = { type: def.type, defaultValue: def.defaultValue };
    if (def.variantOptions) {
      entry.variantOptions = [...def.variantOptions];
    }
    if (def.preferredValues) {
      entry.preferredValues = def.preferredValues.map((value) => ({ type: value.type, key: value.key }));
    }
    if (def.description) {
      entry.description = def.description;
    }
    if (def.slotSettings) {
      entry.slotSettings = toPlain(def.slotSettings) as Record<string, unknown>;
    }
    if (def.type === "INSTANCE_SWAP" && typeof def.defaultValue === "string") {
      entry.defaultRef = await refById(def.defaultValue, ctx);
    }
    out[name] = entry;
  }
  return { description: node.description ?? "", definitions: out };
}

async function serializeInstance(node: InstanceNode, ctx: SerializeContext): Promise<SerializedInstance | undefined> {
  let main: ComponentNode | null = null;
  try {
    main = await node.getMainComponentAsync();
  } catch {
    main = null;
  }
  if (!main) {
    return undefined;
  }
  const ref = await refFromComponent(main, ctx);
  const properties: Record<string, string | boolean> = {};
  const swapRefs: Record<string, SerializedComponentRef> = {};
  let componentProperties: ComponentProperties = {};
  try {
    componentProperties = node.componentProperties;
  } catch {
    componentProperties = {};
  }
  for (const [name, property] of Object.entries(componentProperties)) {
    if (property.type === "SLOT" || property.type === "VARIANT") {
      continue;
    }
    properties[name] = property.value;
    if (property.type === "INSTANCE_SWAP" && typeof property.value === "string") {
      const swapped = await refById(property.value, ctx);
      if (swapped) {
        swapRefs[name] = swapped;
      }
    }
  }
  const result: SerializedInstance = { ...ref, properties };
  if (Object.keys(swapRefs).length > 0) {
    result.swapRefs = swapRefs;
  }
  return result;
}

async function serializeNode(
  node: SceneNode,
  ctx: SerializeContext
): Promise<SerializedNode | null> {
  const type = serializedType(node, ctx.mode);
  if (!type) {
    if (ctx.counting) {
      ctx.report.skipped += 1;
    }
    return null;
  }
  if (ctx.counting) {
    ctx.report.nodeCount += 1;
  }

  const props: Record<string, unknown> = {};
  copyProps(node, BASE_PROPS, props);
  if (type !== "GROUP") {
    copyProps(node, GEOMETRY_PROPS, props);
  }
  if (CONTAINER_TYPES.has(type) || type === "SECTION") {
    copyProps(node, FRAME_PROPS, props);
  }
  if (SHAPE_TYPES.has(type)) {
    copyProps(node, SHAPE_PROPS, props);
  }
  if (type === "TEXT") {
    copyProps(node, TEXT_PARAGRAPH_PROPS, props);
  }
  for (const key of ["fills", "strokes"]) {
    if (key in props) {
      props[key] = filterPaints(props[key]);
    }
  }

  const result: SerializedNode = {
    type,
    sourceType: node.type,
    transform: multiply(ctx.origin, node.absoluteTransform as Matrix),
    width: node.width,
    height: node.height,
    props,
  };

  if (CONTAINER_TYPES.has(type)) {
    const layout: Record<string, unknown> = {};
    copyProps(node, LAYOUT_PROPS, layout);
    if (layout.layoutMode && layout.layoutMode !== "NONE") {
      result.layout = layout;
    }
  }

  const childLayout: Record<string, unknown> = {};
  copyProps(node, CHILD_LAYOUT_PROPS, childLayout);
  if (Object.keys(childLayout).length > 0) {
    result.childLayout = childLayout;
  }

  if (node.type === "TEXT") {
    result.text = serializeText(node);
  }
  if (node.type === "VECTOR") {
    try {
      result.vectorNetwork = toPlain(node.vectorNetwork);
    } catch {
      result.vectorPaths = toPlain(node.vectorPaths);
    }
  }
  if (node.type === "BOOLEAN_OPERATION") {
    result.booleanOperation = node.booleanOperation;
  }

  if (ctx.mode === "component") {
    if (node.type === "INSTANCE") {
      let overrides: InstanceNode["overrides"] = [];
      try {
        overrides = node.overrides;
      } catch {
        overrides = [];
      }
      for (const override of overrides) {
        const fields = ctx.overrides.get(override.id) ?? [];
        ctx.overrides.set(override.id, [...new Set([...fields, ...override.overriddenFields])]);
      }
    }
    const refs = readPropertyRefs(node);
    if (refs) {
      result.propertyRefs = refs;
    }
    const overridden = ctx.overrides.get(node.id);
    if (overridden && overridden.length > 0) {
      result.overriddenFields = overridden;
    }
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      result.componentProps = await serializeComponentProps(node, ctx);
    }
    if (node.type === "INSTANCE") {
      result.instance = await serializeInstance(node, ctx);
    }
  }

  if ("children" in node && type !== "TEXT") {
    const children: SerializedNode[] = [];
    for (const child of node.children) {
      const serialized = await serializeNode(child, ctx);
      if (serialized) {
        children.push(serialized);
      }
    }
    result.children = children;
  }
  return result;
}

export interface SerializedSelection {
  roots: SerializedNode[];
  /** Component templates only. */
  components?: Record<string, SerializedNode>;
  report: SerializeReport;
  width: number;
  height: number;
}

function newContext(origin: Matrix, mode: SerializeMode): SerializeContext {
  return {
    origin,
    report: { skipped: 0, nodeCount: 0 },
    mode,
    counting: true,
    overrides: new Map(),
    components: {},
    embedded: new Set(),
  };
}

function unionBounds(nodes: readonly SceneNode[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const box = node.absoluteBoundingBox;
    if (!box) {
      continue;
    }
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export async function serializeSelection(
  roots: readonly SceneNode[]
): Promise<SerializedSelection | null> {
  const bounds = unionBounds(roots);
  if (!bounds) {
    return null;
  }
  const ctx = newContext(translation(-bounds.x, -bounds.y), "layout");
  const serializedRoots: SerializedNode[] = [];
  for (const root of roots) {
    const serialized = await serializeNode(root, ctx);
    if (serialized) {
      serializedRoots.push(serialized);
    }
  }

  return {
    roots: serializedRoots,
    report: ctx.report,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Keeps components, instances and slots, and embeds every non-library main component
 * the template depends on so it can be rebuilt in another file.
 */
export async function serializeComponentTemplate(
  root: ComponentNode | ComponentSetNode
): Promise<SerializedSelection | null> {
  const bounds = unionBounds([root]);
  if (!bounds) {
    return null;
  }
  const ctx = newContext(translation(-bounds.x, -bounds.y), "component");
  ctx.embedded.add(root.key);
  const serialized = await serializeNode(root, ctx);
  if (!serialized) {
    return null;
  }
  return {
    roots: [serialized],
    components: ctx.components,
    report: ctx.report,
    width: bounds.width,
    height: bounds.height,
  };
}
