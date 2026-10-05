import type {
  Matrix,
  RestoreReport,
  SerializedComponentRef,
  SerializedInstance,
  SerializedNode,
  SerializedPropertyDefinition,
  SerializedText,
  SerializedTextSegment,
  TemplateContent,
} from "./types";

const FALLBACK_FONT: FontName = { family: "Inter", style: "Regular" };
const IMAGE_PLACEHOLDER: RGB = { r: 0xd9 / 255, g: 0xd9 / 255, b: 0xd9 / 255 };

/** Marks main components recreated from embedded definitions so later placements reuse them. */
export const SOURCE_KEY_DATA = "cbTemplatePalette.sourceKey";
const PARTS_SECTION_NAME = "テンプレパレット: 部品";
const PARTS_GAP = 40;
const PARTS_OFFSET = 200;

const TEXT_OVERRIDE_FIELDS = new Set([
  "characters",
  "fills",
  "fontName",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textDecoration",
  "textCase",
  "hyperlink",
  "styledTextSegments",
]);

/**
 * - layout: components, instances and slots are built as frames (layout templates)
 * - component: they are rebuilt as real components / instances / slots
 * - flatten: like layout, for thumbnails of component templates
 */
export type RestoreMode = "layout" | "component" | "flatten";

type Container = BaseNode & ChildrenMixin;
type ComponentLike = ComponentNode | ComponentSetNode;

interface PropertyOwner {
  target: ComponentLike | null;
  definitions: Record<string, SerializedPropertyDefinition>;
  /** Saved property name -> name in the rebuilt component. */
  names: Map<string, string>;
  pending: Array<{ node: SceneNode; refs: Record<string, string> }>;
}

interface PartsArea {
  page: PageNode;
  origin: { x: number; y: number };
  section: SectionNode | null;
  cursorY: number;
  maxWidth: number;
}

interface RestoreContext {
  placement: Matrix;
  mode: RestoreMode;
  fonts: Map<string, FontName>;
  report: RestoreReport;
  components: Record<string, SerializedNode>;
  /** Component (or set) key -> resolved node, or null when unavailable. */
  resolved: Map<string, ComponentLike | null>;
  /** Rebuilt component (or set) id -> saved property name -> new property name. */
  propertyNames: Map<string, Map<string, string>>;
  owners: PropertyOwner[];
  /** > 0 while building content whose property references must not be attached. */
  refsSuspended: number;
  parts: PartsArea;
  recreatedOnPage: Map<string, ComponentLike> | null;
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

function invert(m: Matrix): Matrix {
  const [[a, b, tx], [c, d, ty]] = m;
  const det = a * d - b * c || 1;
  return [
    [d / det, -b / det, (b * ty - d * tx) / det],
    [-c / det, a / det, (c * tx - a * ty) / det],
  ];
}

function translation(x: number, y: number): Matrix {
  return [
    [1, 0, x],
    [0, 1, y],
  ];
}

function containerAbsolute(container: Container): Matrix {
  if (container.type === "PAGE" || !("absoluteTransform" in container)) {
    return translation(0, 0);
  }
  return (container as SceneNode).absoluteTransform as Matrix;
}

function relativeTo(container: Container, sn: SerializedNode, ctx: RestoreContext): Matrix {
  const target = multiply(ctx.placement, sn.transform);
  return multiply(invert(containerAbsolute(container)), target);
}

function fontKey(font: { family: string; style: string }): string {
  return `${font.family}\u0000${font.style}`;
}

async function tryLoadFont(font: FontName): Promise<boolean> {
  try {
    await figma.loadFontAsync(font);
    return true;
  } catch {
    return false;
  }
}

function collectFonts(nodes: SerializedNode[], out: Map<string, FontName>): void {
  for (const node of nodes) {
    for (const segment of node.text?.segments ?? []) {
      out.set(fontKey(segment.fontName), segment.fontName);
    }
    if (node.children) {
      collectFonts(node.children, out);
    }
  }
}

async function loadFonts(nodes: SerializedNode[], report: RestoreReport): Promise<Map<string, FontName>> {
  const wanted = new Map<string, FontName>();
  collectFonts(nodes, wanted);
  await tryLoadFont(FALLBACK_FONT);

  const resolved = new Map<string, FontName>();
  for (const [key, font] of wanted) {
    if (await tryLoadFont(font)) {
      resolved.set(key, font);
      continue;
    }
    const regular: FontName = { family: font.family, style: "Regular" };
    const replacement = (await tryLoadFont(regular)) ? regular : FALLBACK_FONT;
    resolved.set(key, replacement);
    report.replacedFonts.push(`${font.family} ${font.style}`);
  }
  return resolved;
}

function placeholderFor(paint: Paint): SolidPaint {
  return {
    type: "SOLID",
    color: IMAGE_PLACEHOLDER,
    opacity: paint.opacity ?? 1,
    visible: paint.visible ?? true,
  };
}

function remapPaints(paints: unknown, ctx: RestoreContext): Paint[] {
  if (!Array.isArray(paints)) {
    return [];
  }
  return (paints as Paint[]).map((paint) => {
    if (paint.type !== "IMAGE") {
      return paint;
    }
    ctx.report.replacedImages += 1;
    return placeholderFor(paint);
  });
}

/** Replaces image paints in an existing subtree (used after cloning). Returns the number replaced. */
export function replaceImagePaintsInTree(root: SceneNode): number {
  let count = 0;
  const visit = (node: SceneNode) => {
    for (const key of ["fills", "strokes"] as const) {
      if (!(key in node)) {
        continue;
      }
      const paints = (node as unknown as Record<string, unknown>)[key];
      if (!Array.isArray(paints) || !paints.some((paint: Paint) => paint.type === "IMAGE")) {
        continue;
      }
      const images = paints.filter((paint: Paint) => paint.type === "IMAGE").length;
      try {
        (node as unknown as Record<string, unknown>)[key] = paints.map((paint: Paint) =>
          paint.type === "IMAGE" ? placeholderFor(paint) : paint
        );
        count += images;
      } catch {
        // Read-only paint (e.g. locked by the editor): keep it.
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(root);
  return count;
}

function remapNetwork(network: unknown, ctx: RestoreContext): VectorNetwork {
  const value = network as VectorNetwork;
  if (!value.regions) {
    return value;
  }
  return {
    ...value,
    regions: value.regions.map((region) =>
      region.fills ? { ...region, fills: remapPaints(region.fills, ctx) } : region
    ),
  };
}

function setProp(
  node: SceneNode,
  key: string,
  value: unknown,
  ctx: RestoreContext,
  countFailure = true
): void {
  if (value === undefined || !(key in node)) {
    return;
  }
  let next = value;
  if (key === "fills" || key === "strokes") {
    next = remapPaints(value, ctx);
  }
  try {
    (node as unknown as Record<string, unknown>)[key] = next;
  } catch {
    if (countFailure) {
      ctx.report.failedProps += 1;
    }
  }
}

function applyProps(node: SceneNode, props: Record<string, unknown>, ctx: RestoreContext): void {
  for (const [key, value] of Object.entries(props)) {
    setProp(node, key, value, ctx);
  }
}

function applyTransform(node: SceneNode, container: Container, sn: SerializedNode, ctx: RestoreContext): void {
  const rel = relativeTo(container, sn, ctx);
  try {
    (node as SceneNode & { relativeTransform: Transform }).relativeTransform = rel;
  } catch {
    if ("x" in node) {
      node.x = rel[0][2];
      node.y = rel[1][2];
    }
  }
}

function resizeNode(node: SceneNode, width: number, height: number): void {
  if (!("resize" in node)) {
    return;
  }
  try {
    (node as LayoutMixin).resize(Math.max(width, 0.01), Math.max(height, 0.01));
  } catch {
    // Some node types (e.g. LINE) accept only a zero height.
    try {
      (node as LayoutMixin).resize(Math.max(width, 0.01), 0);
    } catch {
      // Keep the default size.
    }
  }
}

function applyTextSegment(
  node: TextNode,
  segment: SerializedTextSegment,
  ctx: RestoreContext
): void {
  const { start, end } = segment;
  const font = ctx.fonts.get(fontKey(segment.fontName)) ?? FALLBACK_FONT;
  const steps: Array<() => void> = [
    () => node.setRangeFontName(start, end, font),
    () => node.setRangeFontSize(start, end, segment.fontSize),
    () => node.setRangeFills(start, end, remapPaints(segment.fills, ctx)),
    () => node.setRangeTextDecoration(start, end, segment.textDecoration as TextDecoration),
    () => node.setRangeTextCase(start, end, segment.textCase as TextCase),
    () => node.setRangeLineHeight(start, end, segment.lineHeight as LineHeight),
    () => node.setRangeLetterSpacing(start, end, segment.letterSpacing as LetterSpacing),
    () => {
      if (segment.hyperlink) {
        node.setRangeHyperlink(start, end, segment.hyperlink as HyperlinkTarget);
      }
    },
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      ctx.report.failedProps += 1;
    }
  }
}

function buildText(sn: SerializedNode, container: Container, ctx: RestoreContext): TextNode {
  const node = figma.createText();
  container.appendChild(node);
  const text = sn.text ?? { characters: "", segments: [] };
  const first = text.segments[0];
  node.fontName = first ? ctx.fonts.get(fontKey(first.fontName)) ?? FALLBACK_FONT : FALLBACK_FONT;
  node.characters = text.characters;
  for (const segment of text.segments) {
    applyTextSegment(node, segment, ctx);
  }

  const { fills: _fills, textAutoResize, ...rest } = sn.props;
  applyProps(node, rest, ctx);
  if (typeof textAutoResize === "string") {
    setProp(node, "textAutoResize", textAutoResize, ctx);
  }
  if (node.textAutoResize === "NONE" || node.textAutoResize === "TRUNCATE") {
    resizeNode(node, sn.width, sn.height);
  } else if (node.textAutoResize === "HEIGHT") {
    resizeNode(node, sn.width, node.height);
  }
  applyTransform(node, container, sn, ctx);
  return node;
}

function createShape(sn: SerializedNode): SceneNode {
  switch (sn.type) {
    case "RECTANGLE":
      return figma.createRectangle();
    case "ELLIPSE":
      return figma.createEllipse();
    case "POLYGON":
      return figma.createPolygon();
    case "STAR":
      return figma.createStar();
    case "LINE":
      return figma.createLine();
    default:
      return figma.createVector();
  }
}

async function buildShape(sn: SerializedNode, container: Container, ctx: RestoreContext): Promise<SceneNode> {
  const node = createShape(sn);
  container.appendChild(node);
  if (node.type === "VECTOR") {
    try {
      if (sn.vectorNetwork) {
        await node.setVectorNetworkAsync(remapNetwork(sn.vectorNetwork, ctx));
      } else if (sn.vectorPaths) {
        node.vectorPaths = sn.vectorPaths as VectorPaths;
      }
    } catch {
      ctx.report.failedProps += 1;
    }
  } else {
    resizeNode(node, sn.width, sn.type === "LINE" ? 0 : sn.height);
  }
  applyProps(node, sn.props, ctx);
  applyTransform(node, container, sn, ctx);
  return node;
}

function applyChildLayout(node: SceneNode, sn: SerializedNode, container: Container, ctx: RestoreContext): void {
  const layout = sn.childLayout;
  if (!layout) {
    return;
  }
  const { layoutPositioning, ...rest } = layout;
  if (layoutPositioning) {
    setProp(node, "layoutPositioning", layoutPositioning, ctx, false);
  }
  for (const [key, value] of Object.entries(rest)) {
    setProp(node, key, value, ctx, false);
  }
  if (layoutPositioning === "ABSOLUTE") {
    applyTransform(node, container, sn, ctx);
  }
}

type Built = Array<{ node: SceneNode; sn: SerializedNode }>;

function applyAutoLayout(node: SceneNode, sn: SerializedNode, built: Built, ctx: RestoreContext): void {
  if (!sn.layout || node.type === "SECTION" || !("layoutMode" in node)) {
    return;
  }
  const { layoutMode, primaryAxisSizingMode, counterAxisSizingMode, ...rest } = sn.layout;
  setProp(node, "layoutMode", layoutMode, ctx);
  for (const [key, value] of Object.entries(rest)) {
    setProp(node, key, value, ctx);
  }
  for (const entry of built) {
    applyChildLayout(entry.node, entry.sn, node as unknown as Container, ctx);
  }
  resizeNode(node, sn.width, sn.height);
  setProp(node, "primaryAxisSizingMode", primaryAxisSizingMode, ctx);
  setProp(node, "counterAxisSizingMode", counterAxisSizingMode, ctx);
}

async function fillContainer(
  node: FrameNode | SectionNode | ComponentNode,
  sn: SerializedNode,
  container: Container,
  ctx: RestoreContext
): Promise<void> {
  applyProps(node, sn.props, ctx);
  if (node.type === "SECTION") {
    node.resizeWithoutConstraints(Math.max(sn.width, 1), Math.max(sn.height, 1));
  } else {
    resizeNode(node, sn.width, sn.height);
  }
  applyTransform(node, container, sn, ctx);

  const built: Built = [];
  for (const child of sn.children ?? []) {
    const childNode = await buildNode(child, node, ctx);
    if (childNode) {
      built.push({ node: childNode, sn: child });
    }
  }
  applyAutoLayout(node, sn, built, ctx);
}

async function buildContainer(sn: SerializedNode, container: Container, ctx: RestoreContext): Promise<SceneNode> {
  const node = sn.type === "SECTION" ? figma.createSection() : figma.createFrame();
  container.appendChild(node);
  await fillContainer(node, sn, container, ctx);
  return node;
}

async function buildCombined(
  sn: SerializedNode,
  container: Container,
  ctx: RestoreContext
): Promise<SceneNode | null> {
  // Groups and boolean ops have no coordinate space: children live in the container.
  const children: SceneNode[] = [];
  for (const child of sn.children ?? []) {
    const childNode = await buildNode(child, container, ctx);
    if (childNode) {
      children.push(childNode);
    }
  }
  if (children.length === 0) {
    return null;
  }
  if (sn.type === "GROUP") {
    const group = figma.group(children, container);
    applyProps(group, sn.props, ctx);
    return group;
  }
  const boolean = figma.union(children, container);
  if (sn.booleanOperation) {
    setProp(boolean, "booleanOperation", sn.booleanOperation, ctx);
  }
  applyProps(boolean, sn.props, ctx);
  return boolean;
}

// ---------------------------------------------------------------------------
// Component properties

function baseName(propertyName: string): string {
  return propertyName.replace(/#[^#]*$/, "");
}

function newOwner(
  target: ComponentLike | null,
  definitions: Record<string, SerializedPropertyDefinition> | undefined
): PropertyOwner {
  return { target, definitions: definitions ?? {}, names: new Map(), pending: [] };
}

function addProperty(
  target: ComponentLike,
  name: string,
  type: ComponentPropertyType,
  defaultValue: string | boolean,
  options?: ComponentPropertyOptions
): string {
  try {
    return target.addComponentProperty(name, type, defaultValue, options);
  } catch (err) {
    if (!options) {
      throw err;
    }
    // Preferred values point at library keys that may not be available here.
    return target.addComponentProperty(name, type, defaultValue, {
      description: options.description,
      slotSettings: options.slotSettings,
    });
  }
}

async function addDefinitions(owner: PropertyOwner, ctx: RestoreContext): Promise<void> {
  if (!owner.target) {
    return;
  }
  for (const [name, def] of Object.entries(owner.definitions)) {
    if (def.type === "VARIANT" || def.type === "SLOT") {
      continue;
    }
    try {
      let defaultValue = def.defaultValue;
      let options: ComponentPropertyOptions | undefined;
      if (def.type === "INSTANCE_SWAP") {
        const main = def.defaultRef ? await resolveComponent(def.defaultRef, ctx) : null;
        if (!main) {
          ctx.report.failedComponentProps += 1;
          continue;
        }
        defaultValue = main.id;
        if (def.preferredValues && def.preferredValues.length > 0) {
          options = { preferredValues: def.preferredValues };
        }
      }
      owner.names.set(name, addProperty(owner.target, baseName(name), def.type, defaultValue, options));
    } catch {
      ctx.report.failedComponentProps += 1;
    }
  }
}

function addSlotProperty(owner: PropertyOwner, savedName: string, ctx: RestoreContext): string | undefined {
  const def = owner.definitions[savedName];
  if (!def || def.type !== "SLOT" || !owner.target) {
    return undefined;
  }
  try {
    const options: ComponentPropertyOptions = {};
    if (def.description) {
      options.description = def.description;
    }
    if (def.preferredValues && def.preferredValues.length > 0) {
      options.preferredValues = def.preferredValues;
    }
    if (def.slotSettings) {
      options.slotSettings = def.slotSettings as SlotSettings;
    }
    const name = addProperty(owner.target, baseName(savedName), "SLOT", "", options);
    owner.names.set(savedName, name);
    return name;
  } catch {
    ctx.report.failedComponentProps += 1;
    return undefined;
  }
}

function applyPendingRefs(owner: PropertyOwner, ctx: RestoreContext): void {
  for (const { node, refs } of owner.pending) {
    const mapped: Record<string, string> = {};
    for (const [field, savedName] of Object.entries(refs)) {
      const name =
        owner.names.get(savedName) ??
        (field === "slotContentId" ? addSlotProperty(owner, savedName, ctx) : undefined);
      if (name) {
        mapped[field] = name;
      } else {
        ctx.report.failedComponentProps += 1;
      }
    }
    if (Object.keys(mapped).length === 0 || node.removed) {
      continue;
    }
    try {
      (node as unknown as { componentPropertyReferences: Record<string, string> }).componentPropertyReferences =
        mapped;
    } catch {
      ctx.report.failedComponentProps += 1;
    }
  }
}

async function buildComponent(
  sn: SerializedNode,
  container: Container,
  ctx: RestoreContext,
  isVariant: boolean
): Promise<ComponentNode> {
  const node = figma.createComponent();
  container.appendChild(node);
  let owner: PropertyOwner | null = null;
  if (!isVariant) {
    owner = newOwner(node, sn.componentProps?.definitions);
    await addDefinitions(owner, ctx);
    ctx.owners.push(owner);
  }
  try {
    await fillContainer(node, sn, container, ctx);
  } finally {
    if (owner) {
      ctx.owners.pop();
    }
  }
  if (owner) {
    applyPendingRefs(owner, ctx);
    ctx.propertyNames.set(node.id, owner.names);
  }
  if (sn.componentProps?.description) {
    try {
      node.description = sn.componentProps.description;
    } catch {
      // Description is optional.
    }
  }
  return node;
}

async function buildComponentSet(
  sn: SerializedNode,
  container: Container,
  ctx: RestoreContext
): Promise<SceneNode | null> {
  // Variant sublayers reference the set's properties, so collect their references until the set exists.
  const owner = newOwner(null, sn.componentProps?.definitions);
  const variants: Built = [];
  ctx.owners.push(owner);
  try {
    for (const child of sn.children ?? []) {
      if (child.type === "COMPONENT") {
        variants.push({ node: await buildComponent(child, container, ctx, true), sn: child });
      }
    }
  } finally {
    ctx.owners.pop();
  }
  if (variants.length === 0) {
    return null;
  }

  let set: ComponentSetNode;
  try {
    set = figma.combineAsVariants(
      variants.map((entry) => entry.node as ComponentNode),
      container
    );
  } catch {
    ctx.report.failedComponentProps += 1;
    return variants[0].node;
  }
  applyProps(set, sn.props, ctx);
  resizeNode(set, sn.width, sn.height);
  applyTransform(set, container, sn, ctx);
  for (const entry of variants) {
    applyTransform(entry.node, set, entry.sn, ctx);
  }
  applyAutoLayout(set, sn, variants, ctx);

  owner.target = set;
  await addDefinitions(owner, ctx);
  applyPendingRefs(owner, ctx);
  ctx.propertyNames.set(set.id, owner.names);
  if (sn.componentProps?.description) {
    try {
      set.description = sn.componentProps.description;
    } catch {
      // Description is optional.
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// Resolving main components

async function importByKey(ref: SerializedComponentRef): Promise<ComponentLike | null> {
  try {
    return ref.setKey
      ? await figma.importComponentSetByKeyAsync(ref.setKey)
      : await figma.importComponentByKeyAsync(ref.key);
  } catch {
    return null;
  }
}

async function findLocal(ref: SerializedComponentRef): Promise<ComponentLike | null> {
  const key = ref.setKey ?? ref.key;
  try {
    const node = await figma.getNodeByIdAsync(ref.setId ?? ref.id);
    if (
      node &&
      !node.removed &&
      (node.type === "COMPONENT" || node.type === "COMPONENT_SET") &&
      node.key === key
    ) {
      return node;
    }
  } catch {
    // Not in this file.
  }
  return null;
}

function findRecreated(key: string, ctx: RestoreContext): ComponentLike | null {
  if (!ctx.recreatedOnPage) {
    ctx.recreatedOnPage = new Map();
    const nodes = ctx.parts.page.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
    for (const node of nodes) {
      const sourceKey = node.getPluginData(SOURCE_KEY_DATA);
      if (sourceKey && !ctx.recreatedOnPage.has(sourceKey)) {
        ctx.recreatedOnPage.set(sourceKey, node);
      }
    }
  }
  const found = ctx.recreatedOnPage.get(key);
  return found && !found.removed ? found : null;
}

function ensurePartsSection(ctx: RestoreContext): SectionNode {
  const parts = ctx.parts;
  if (!parts.section || parts.section.removed) {
    const section = figma.createSection();
    section.name = PARTS_SECTION_NAME;
    parts.page.appendChild(section);
    section.x = parts.origin.x;
    section.y = parts.origin.y;
    parts.section = section;
    parts.cursorY = parts.origin.y + PARTS_GAP;
    parts.maxWidth = 0;
  }
  return parts.section;
}

async function recreate(key: string, ctx: RestoreContext): Promise<ComponentLike | null> {
  const def = ctx.components[key];
  if (!def) {
    return null;
  }
  const section = ensurePartsSection(ctx);
  const savedPlacement = ctx.placement;
  const savedSuspended = ctx.refsSuspended;
  ctx.placement = translation(ctx.parts.origin.x + PARTS_GAP, ctx.parts.cursorY);
  ctx.refsSuspended = 0;
  let built: SceneNode | null = null;
  try {
    built = await buildNode(def, section, ctx);
  } finally {
    ctx.placement = savedPlacement;
    ctx.refsSuspended = savedSuspended;
  }
  if (!built || (built.type !== "COMPONENT" && built.type !== "COMPONENT_SET")) {
    built?.remove();
    return null;
  }
  built.setPluginData(SOURCE_KEY_DATA, key);
  ctx.recreatedOnPage?.set(key, built);
  ctx.report.createdComponents += 1;

  const parts = ctx.parts;
  parts.cursorY += def.height + PARTS_GAP;
  parts.maxWidth = Math.max(parts.maxWidth, def.width);
  section.resizeWithoutConstraints(parts.maxWidth + PARTS_GAP * 2, parts.cursorY - parts.origin.y);
  return built;
}

async function resolveDefinition(ref: SerializedComponentRef, ctx: RestoreContext): Promise<ComponentLike | null> {
  const key = ref.setKey ?? ref.key;
  const cached = ctx.resolved.get(key);
  if (cached !== undefined) {
    return cached && !cached.removed ? cached : null;
  }
  ctx.resolved.set(key, null);
  let found: ComponentLike | null = null;
  if (ref.remote) {
    found = await importByKey(ref);
  }
  found = found ?? (await findLocal(ref)) ?? findRecreated(key, ctx) ?? (await recreate(key, ctx));
  ctx.resolved.set(key, found);
  return found;
}

async function resolveComponent(ref: SerializedComponentRef, ctx: RestoreContext): Promise<ComponentNode | null> {
  const def = await resolveDefinition(ref, ctx);
  if (!def) {
    return null;
  }
  if (def.type === "COMPONENT") {
    return def;
  }
  const variant = def.children.find(
    (child): child is ComponentNode => child.type === "COMPONENT" && child.name === ref.variantName
  );
  return variant ?? def.defaultVariant;
}

// ---------------------------------------------------------------------------
// Instances

async function setInstanceProperties(
  instance: InstanceNode,
  main: ComponentNode,
  ref: SerializedInstance,
  ctx: RestoreContext
): Promise<void> {
  const owner: ComponentLike = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : main;
  const names = ctx.propertyNames.get(owner.id);
  let definitions: ComponentPropertyDefinitions = {};
  try {
    definitions = owner.componentPropertyDefinitions;
  } catch {
    definitions = {};
  }
  const values: Record<string, string | boolean> = {};
  for (const [savedName, value] of Object.entries(ref.properties)) {
    const name = names ? names.get(savedName) : savedName;
    if (!name || !definitions[name]) {
      continue;
    }
    if (definitions[name].type === "INSTANCE_SWAP") {
      const swapRef = ref.swapRefs?.[savedName];
      const swapped = swapRef ? await resolveComponent(swapRef, ctx) : null;
      if (!swapped) {
        ctx.report.failedComponentProps += 1;
        continue;
      }
      values[name] = swapped.id;
      continue;
    }
    values[name] = value;
  }
  if (Object.keys(values).length === 0) {
    return;
  }
  try {
    instance.setProperties(values);
  } catch {
    for (const [name, value] of Object.entries(values)) {
      try {
        instance.setProperties({ [name]: value });
      } catch {
        ctx.report.failedComponentProps += 1;
      }
    }
  }
}

async function applyTextOverride(node: TextNode, text: SerializedText, ctx: RestoreContext): Promise<void> {
  try {
    const fonts =
      node.characters.length > 0
        ? node.getRangeAllFontNames(0, node.characters.length)
        : node.fontName !== figma.mixed
          ? [node.fontName]
          : [];
    for (const font of fonts) {
      await tryLoadFont(font);
    }
    node.characters = text.characters;
  } catch {
    ctx.report.failedProps += 1;
    return;
  }
  for (const segment of text.segments) {
    applyTextSegment(node, segment, ctx);
  }
}

async function applyOverriddenFields(node: SceneNode, sn: SerializedNode, ctx: RestoreContext): Promise<void> {
  const fields = sn.overriddenFields;
  if (!fields || fields.length === 0) {
    return;
  }
  let textDone = false;
  let sizeDone = false;
  for (const field of fields) {
    if (node.type === "TEXT" && sn.text && TEXT_OVERRIDE_FIELDS.has(field)) {
      if (!textDone) {
        await applyTextOverride(node, sn.text, ctx);
        textDone = true;
      }
      continue;
    }
    if (field === "width" || field === "height") {
      if (!sizeDone) {
        resizeNode(node, sn.width, sn.height);
        sizeDone = true;
      }
      continue;
    }
    const source =
      field in sn.props
        ? sn.props
        : sn.childLayout && field in sn.childLayout
          ? sn.childLayout
          : sn.layout && field in sn.layout
            ? sn.layout
            : null;
    if (source) {
      setProp(node, field, source[field], ctx, false);
    }
  }
}

async function rebuildSlotContent(slot: SlotNode, sn: SerializedNode, ctx: RestoreContext): Promise<void> {
  ctx.refsSuspended += 1;
  try {
    for (const child of [...slot.children]) {
      child.remove();
    }
    for (const child of sn.children ?? []) {
      const built = await buildNode(child, slot, ctx);
      if (built) {
        applyChildLayout(built, child, slot, ctx);
      }
    }
  } catch {
    ctx.report.failedProps += 1;
  } finally {
    ctx.refsSuspended -= 1;
  }
}

async function applyChildOverrides(parent: SceneNode, sn: SerializedNode, ctx: RestoreContext): Promise<void> {
  if (!("children" in parent) || !sn.children) {
    return;
  }
  const nodes = parent.children;
  const count = Math.min(nodes.length, sn.children.length);
  for (let i = 0; i < count; i += 1) {
    const node = nodes[i];
    const child = sn.children[i];
    if (node.type === "SLOT" && child.type === "SLOT") {
      await rebuildSlotContent(node, child, ctx);
      continue;
    }
    if (node.type === "INSTANCE" && child.type === "INSTANCE" && child.instance) {
      const desired = await resolveComponent(child.instance, ctx);
      let current: ComponentNode | null = null;
      try {
        current = await node.getMainComponentAsync();
      } catch {
        current = null;
      }
      if (desired && current && desired.id !== current.id) {
        try {
          node.swapComponent(desired);
        } catch {
          ctx.report.failedComponentProps += 1;
        }
      }
      await applyOverriddenFields(node, child, ctx);
      if (desired) {
        await setInstanceProperties(node, desired, child.instance, ctx);
      }
      await applyChildOverrides(node, child, ctx);
      continue;
    }
    await applyOverriddenFields(node, child, ctx);
    await applyChildOverrides(node, child, ctx);
  }
}

async function buildDetachedInstance(sn: SerializedNode, container: Container, ctx: RestoreContext): Promise<SceneNode> {
  ctx.report.detachedInstances += 1;
  ctx.refsSuspended += 1;
  try {
    return await buildContainer(sn, container, ctx);
  } finally {
    ctx.refsSuspended -= 1;
  }
}

async function buildInstance(sn: SerializedNode, container: Container, ctx: RestoreContext): Promise<SceneNode> {
  const ref = sn.instance;
  const main = ref ? await resolveComponent(ref, ctx) : null;
  if (!ref || !main) {
    return buildDetachedInstance(sn, container, ctx);
  }
  let instance: InstanceNode;
  try {
    instance = main.createInstance();
  } catch {
    return buildDetachedInstance(sn, container, ctx);
  }
  container.appendChild(instance);
  await setInstanceProperties(instance, main, ref, ctx);
  await applyOverriddenFields(instance, sn, ctx);
  if (Math.abs(instance.width - sn.width) > 0.01 || Math.abs(instance.height - sn.height) > 0.01) {
    resizeNode(instance, sn.width, sn.height);
  }
  applyTransform(instance, container, sn, ctx);
  await applyChildOverrides(instance, sn, ctx);
  return instance;
}

// ---------------------------------------------------------------------------

async function buildNodeOfType(
  sn: SerializedNode,
  container: Container,
  ctx: RestoreContext
): Promise<SceneNode | null> {
  const asComponents = ctx.mode === "component";
  switch (sn.type) {
    case "FRAME":
    case "SECTION":
    case "SLOT":
      return buildContainer(sn, container, ctx);
    case "COMPONENT":
      return asComponents ? buildComponent(sn, container, ctx, false) : buildContainer(sn, container, ctx);
    case "COMPONENT_SET":
      return asComponents ? buildComponentSet(sn, container, ctx) : buildContainer(sn, container, ctx);
    case "INSTANCE":
      return asComponents ? buildInstance(sn, container, ctx) : buildContainer(sn, container, ctx);
    case "GROUP":
    case "BOOLEAN_OPERATION":
      return buildCombined(sn, container, ctx);
    case "TEXT":
      return buildText(sn, container, ctx);
    default:
      return buildShape(sn, container, ctx);
  }
}

async function buildNode(
  sn: SerializedNode,
  container: Container,
  ctx: RestoreContext
): Promise<SceneNode | null> {
  const node = await buildNodeOfType(sn, container, ctx);
  if (node && sn.propertyRefs && ctx.mode === "component" && ctx.refsSuspended === 0) {
    const owner = ctx.owners[ctx.owners.length - 1];
    owner?.pending.push({ node, refs: sn.propertyRefs });
  }
  return node;
}

export interface RestoreOptions {
  mode?: RestoreMode;
}

export interface RestoreResult {
  nodes: SceneNode[];
  report: RestoreReport;
  /** Section holding main components recreated for this placement, if any. */
  partsSection: SectionNode | null;
}

export async function restoreTemplate(
  content: TemplateContent,
  page: PageNode,
  topLeft: { x: number; y: number },
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  const mode = options.mode ?? "layout";
  const report: RestoreReport = {
    replacedFonts: [],
    failedProps: 0,
    replacedImages: 0,
    createdComponents: 0,
    detachedInstances: 0,
    failedComponentProps: 0,
  };
  const components = mode === "component" ? content.components ?? {} : {};
  const right = content.roots.reduce(
    (max, root) => Math.max(max, root.transform[0][2] + root.width),
    0
  );
  const ctx: RestoreContext = {
    placement: translation(topLeft.x, topLeft.y),
    mode,
    fonts: await loadFonts([...content.roots, ...Object.values(components)], report),
    report,
    components,
    resolved: new Map(),
    propertyNames: new Map(),
    owners: [],
    refsSuspended: 0,
    parts: {
      page,
      origin: { x: Math.round(topLeft.x + right + PARTS_OFFSET), y: Math.round(topLeft.y) },
      section: null,
      cursorY: 0,
      maxWidth: 0,
    },
    recreatedOnPage: null,
  };
  const nodes: SceneNode[] = [];
  for (const root of content.roots) {
    const node = await buildNode(root, page, ctx);
    if (node) {
      nodes.push(node);
    }
  }
  return { nodes, report, partsSection: ctx.parts.section };
}
