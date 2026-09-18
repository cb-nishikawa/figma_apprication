import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type {
  CheckResult,
  ComparePair,
  HoverHighlightItem,
  IgnoreCategories,
  KeywordQuery,
  SearchMode,
  TextMatch,
  TextNodeLike,
} from "./types";
import { DEFAULT_IGNORE_CATEGORIES } from "./types";
import {
  compareDiffToResults,
  compareTextNodes,
  type TextCompareDiff,
} from "./compare";
import {
  buildHighlightPool,
  clearHoverHighlight,
  hideAllHighlights,
  recolorHighlightItems,
  showHoverHighlight,
} from "./highlight";
import { collectPinTargets } from "./pinTargets";
import { checkKeywords, dedupeTextNodes } from "./search";

const UI_WIDTH = 360;
const DEFAULT_UI_HEIGHT = 560;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const UI_HEIGHT_STORAGE_KEY = "uiHeight";

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)));
}

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: DEFAULT_UI_HEIGHT,
  themeColors: true,
});

void (async () => {
  const saved = await figma.clientStorage.getAsync(UI_HEIGHT_STORAGE_KEY);
  if (typeof saved === "number") {
    figma.ui.resize(UI_WIDTH, clampUiHeight(saved));
  }
})();

const PREVIEW_MAX_LENGTH = 40;

function emptyComparePair(): ComparePair {
  return { idA: null, idB: null };
}

const IMAGE_EXPORT_MAX_SIDE = 1600;

let mode: SearchMode = "pinned";
let pinnedNodeId: string | null = null;
let comparePairs: ComparePair[] = [emptyComparePair()];
let imageTargetId: string | null = null;
let lastQueries: KeywordQuery[] = [];
let lastIgnoreStrings: string[] = [];
let lastIgnoreCategories: IgnoreCategories = { ...DEFAULT_IGNORE_CATEGORIES };
let lastResults: CheckResult[] = [];
/** Skip selection-driven work while creating/removing highlight overlays. */
let ignoreSelectionForHighlight = false;

async function withHighlightMutation(
  action: () => void | Promise<void>
): Promise<void> {
  ignoreSelectionForHighlight = true;
  try {
    await action();
  } finally {
    ignoreSelectionForHighlight = false;
  }
}

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function isPinTargetNode(
  node: BaseNode
): node is FrameNode | SectionNode | InstanceNode | GroupNode {
  return (
    node.type === "FRAME" ||
    node.type === "SECTION" ||
    node.type === "INSTANCE" ||
    node.type === "GROUP"
  );
}

function isEffectivelyVisible(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if ("visible" in current && current.visible === false) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

function isVisibleTextNode(node: BaseNode): node is TextNode {
  return node.type === "TEXT" && isEffectivelyVisible(node);
}

function collectTextFromRoot(root: BaseNode & ChildrenMixin): TextNode[] {
  return root.findAll((n) => isVisibleTextNode(n)) as TextNode[];
}

function makePreview(characters: string): string {
  const flat = characters.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX_LENGTH) {
    return flat;
  }
  return `${flat.slice(0, PREVIEW_MAX_LENGTH)}…`;
}

function makeRangePreview(characters: string, start: number, end: number): string {
  const slice = characters.slice(start, end);
  return makePreview(slice);
}

function enrichMatches(
  matches: TextMatch[],
  nodeById: Map<string, TextNode>,
  likeById?: Map<string, TextNodeLike>
): TextMatch[] {
  return matches.map((match) => {
    const node = nodeById.get(match.nodeId);
    const like = likeById?.get(match.nodeId);
    const characters = node?.characters ?? like?.characters ?? "";
    const range = match.ranges[0];
    const preview = range
      ? makeRangePreview(characters, range.start, range.end)
      : makePreview(characters);
    return {
      ...match,
      nodeName: node?.name || (like ? "OCR" : "(untitled)"),
      preview,
    };
  });
}

function enrichResults(
  results: CheckResult[],
  nodes: TextNode[],
  likes: TextNodeLike[] = []
): CheckResult[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const likeById =
    likes.length > 0 ? new Map(likes.map((n) => [n.id, n])) : undefined;
  return results.map((result) => ({
    ...result,
    matches: enrichMatches(result.matches, nodeById, likeById),
    children: result.children
      ? enrichResults(result.children, nodes, likes)
      : undefined,
  }));
}

function postPinTargets(): void {
  const targets = collectPinTargets();
  if (pinnedNodeId && !targets.some((t) => t.id === pinnedNodeId)) {
    pinnedNodeId = null;
  }
  postToUi({
    type: "PIN_TARGETS",
    targets,
    pinnedNodeId,
  });
}

function sanitizeComparePairs(
  targets: ReturnType<typeof collectPinTargets>
): void {
  const valid = new Set(targets.map((t) => t.id));
  for (const pair of comparePairs) {
    if (pair.idA && !valid.has(pair.idA)) {
      pair.idA = null;
    }
    if (pair.idB && !valid.has(pair.idB)) {
      pair.idB = null;
    }
  }
  if (comparePairs.length === 0) {
    comparePairs = [emptyComparePair()];
  }
}

function postCompareState(): void {
  const targets = collectPinTargets();
  sanitizeComparePairs(targets);
  postToUi({
    type: "COMPARE_STATE",
    targets,
    pairs: comparePairs.map((p) => ({ ...p })),
  });
}

function postImageState(): void {
  const targets = collectPinTargets();
  if (imageTargetId && !targets.some((t) => t.id === imageTargetId)) {
    imageTargetId = null;
  }
  postToUi({
    type: "IMAGE_STATE",
    targets,
    targetId: imageTargetId,
  });
}

function exportScaleForNode(node: SceneNode): number {
  const width = "width" in node ? Number(node.width) || 1 : 1;
  const height = "height" in node ? Number(node.height) || 1 : 1;
  const maxSide = Math.max(width, height);
  if (maxSide <= 0) {
    return 1;
  }
  const scale = IMAGE_EXPORT_MAX_SIDE / maxSide;
  return Math.min(2, Math.max(0.25, scale));
}

async function handleExportImageFromSelection(): Promise<void> {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    postToUi({
      type: "ERROR",
      message: "画像にするノードを選択してください",
    });
    return;
  }

  const node = selection[0];
  if (!("exportAsync" in node)) {
    postToUi({
      type: "ERROR",
      message: "このノードは画像として書き出せません",
    });
    return;
  }

  const exportScale = exportScaleForNode(node);
  const bytes = await node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: exportScale },
  });

  postToUi({
    type: "IMAGE_EXPORTED",
    nodeId: node.id,
    name: node.name || "(untitled)",
    bytes: Array.from(bytes),
    exportScale,
  });
}

async function handleImageCompare(
  ocrTexts: TextNodeLike[],
  options: {
    imageNodeId: string;
    exportScale: number;
    ocrRegions: Array<{ id: string; poly: Array<[number, number]> }>;
    ignoreStrings?: string[];
    ignoreCategories?: IgnoreCategories;
  }
): Promise<void> {
  const ignoreStrings = options.ignoreStrings ?? lastIgnoreStrings;
  const ignoreCategories = options.ignoreCategories ?? lastIgnoreCategories;
  lastIgnoreStrings = ignoreStrings;
  lastIgnoreCategories = ignoreCategories;
  await withHighlightMutation(async () => {
    clearHoverHighlight();
  });

  if (ocrTexts.length === 0) {
    lastResults = [];
    postToUi({ type: "ERROR", message: "OCR 結果がありません" });
    return;
  }

  if (!imageTargetId) {
    lastResults = [];
    postToUi({ type: "ERROR", message: "比較ターゲットが未選択です" });
    return;
  }

  const root = await resolveCompareRoot(imageTargetId, "比較ターゲット");
  if ("error" in root) {
    lastResults = [];
    postImageState();
    postToUi({ type: "ERROR", message: root.error });
    return;
  }

  const nodesB = dedupeTextNodes(collectTextFromRoot(root));
  const diff = compareTextNodes(
    ocrTexts,
    nodesB.map((n) => ({ id: n.id, characters: n.characters })),
    ignoreStrings,
    ignoreCategories
  );
  const results = enrichResults(
    compareDiffToResults(diff),
    nodesB,
    ocrTexts
  );
  lastResults = results;

  const regionById = new Map(
    options.ocrRegions.map((region) => [region.id, region])
  );
  const exportScale =
    options.exportScale > 0 ? options.exportScale : 1;
  const highlightItems: HoverHighlightItem[] = [];
  for (const item of resultsToHighlightItems(results)) {
    if (!item.nodeId.startsWith("ocr:")) {
      highlightItems.push(item);
      continue;
    }
    const region = regionById.get(item.nodeId);
    if (!region || region.poly.length === 0 || !options.imageNodeId) {
      continue;
    }
    highlightItems.push({
      nodeId: options.imageNodeId,
      style: item.style,
      exact: item.exact,
      ranges: [],
      ocrRegion: {
        id: region.id,
        exportScale,
        poly: region.poly,
      },
    });
  }
  await withHighlightMutation(async () => {
    await buildHighlightPool(highlightItems);
  });

  postToUi({ type: "SEARCH_RESULT", results });
}

/** Prefer selected pin target, else nearest pin-target ancestor. */
function resolvePinTargetFromSelection(): string | null {
  const selection = figma.currentPage.selection;
  for (const node of selection) {
    if (isPinTargetNode(node)) {
      return node.id;
    }
  }

  const first = selection[0];
  if (!first) {
    return null;
  }

  let current: BaseNode | null = first.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (isPinTargetNode(current)) {
      return current.id;
    }
    current = current.parent;
  }
  return null;
}

async function getSearchNodes(): Promise<TextNode[] | { error: string }> {
  if (mode === "compare" || mode === "image") {
    return { error: "このモードではキーワード検索は使えません" };
  }

  if (!pinnedNodeId) {
    return { error: "固定先が未選択です" };
  }

  const node = await figma.getNodeByIdAsync(pinnedNodeId);
  if (!node || !isPinTargetNode(node)) {
    pinnedNodeId = null;
    postPinTargets();
    return { error: "固定先が見つかりません" };
  }

  return collectTextFromRoot(node);
}

function resultsToHighlightItems(results: CheckResult[]): HoverHighlightItem[] {
  const items: HoverHighlightItem[] = [];
  for (const result of results) {
    if (result.children && result.children.length > 0) {
      items.push(...resultsToHighlightItems(result.children));
      continue;
    }
    for (const match of result.matches) {
      items.push({
        nodeId: match.nodeId,
        style: match.exact ? "component" : "instance",
        exact: match.exact,
        ranges: match.ranges,
      });
    }
  }
  return items;
}

function resultKey(result: CheckResult, parentKey?: string): string {
  return parentKey ? `${parentKey}::${result.keyword}` : result.keyword;
}

function findResultByKey(
  results: CheckResult[],
  key: string,
  parentKey?: string
): CheckResult | null {
  for (const result of results) {
    const keyForResult = resultKey(result, parentKey);
    if (keyForResult === key) {
      return result;
    }
    if (result.children) {
      const nested = findResultByKey(result.children, key, keyForResult);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function collectResultMatches(result: CheckResult): TextMatch[] {
  if (result.children && result.children.length > 0) {
    return result.children.flatMap(collectResultMatches);
  }
  return result.matches;
}

async function handleSearch(
  queries: KeywordQuery[],
  ignoreStrings: string[] = lastIgnoreStrings,
  ignoreCategories: IgnoreCategories = lastIgnoreCategories
): Promise<void> {
  if (mode === "compare") {
    await handleCompare(ignoreStrings, ignoreCategories);
    return;
  }
  if (mode === "image") {
    return;
  }

  await withHighlightMutation(async () => {
    clearHoverHighlight();
  });
  lastQueries = queries;
  lastIgnoreStrings = ignoreStrings;
  lastIgnoreCategories = ignoreCategories;

  if (queries.length === 0) {
    lastResults = [];
    postToUi({ type: "SEARCH_RESULT", results: [] });
    return;
  }

  const nodesOrError = await getSearchNodes();
  if ("error" in nodesOrError) {
    lastResults = [];
    postToUi({ type: "ERROR", message: nodesOrError.error });
    return;
  }

  const nodes = nodesOrError;
  if (nodes.length === 0) {
    lastResults = [];
    postToUi({ type: "ERROR", message: "検索対象のテキストがありません。" });
    return;
  }

  const rawResults = checkKeywords(
    nodes.map((n) => ({ id: n.id, characters: n.characters })),
    queries,
    ignoreStrings,
    ignoreCategories
  );

  const results = enrichResults(rawResults, nodes);
  lastResults = results;

  await withHighlightMutation(async () => {
    await buildHighlightPool(resultsToHighlightItems(results));
  });

  postToUi({ type: "SEARCH_RESULT", results });
}

async function resolveCompareRoot(
  nodeId: string | null,
  label: string
): Promise<
  FrameNode | SectionNode | InstanceNode | GroupNode | { error: string }
> {
  if (!nodeId) {
    return { error: `${label} が未選択です` };
  }
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || !isPinTargetNode(node)) {
    return { error: `${label} が見つかりません` };
  }
  return node;
}

async function handleCompare(
  ignoreStrings: string[] = lastIgnoreStrings,
  ignoreCategories: IgnoreCategories = lastIgnoreCategories
): Promise<void> {
  lastIgnoreStrings = ignoreStrings;
  lastIgnoreCategories = ignoreCategories;
  await withHighlightMutation(async () => {
    clearHoverHighlight();
  });

  const targets = collectPinTargets();
  sanitizeComparePairs(targets);

  const activePairs = comparePairs.filter((p) => p.idA && p.idB);
  if (activePairs.length === 0) {
    lastResults = [];
    postCompareState();
    postToUi({ type: "ERROR", message: "比較ペアが未選択です" });
    return;
  }

  const merged: TextCompareDiff = {
    matchedExact: [],
    matchedPartial: [],
    onlyA: [],
    onlyB: [],
  };
  const allNodes: TextNode[] = [];

  for (let i = 0; i < activePairs.length; i++) {
    const pair = activePairs[i];
    const rootA = await resolveCompareRoot(pair.idA, `比較 A (${i + 1})`);
    if ("error" in rootA) {
      lastResults = [];
      postCompareState();
      postToUi({ type: "ERROR", message: rootA.error });
      return;
    }
    const rootB = await resolveCompareRoot(pair.idB, `比較 B (${i + 1})`);
    if ("error" in rootB) {
      lastResults = [];
      postCompareState();
      postToUi({ type: "ERROR", message: rootB.error });
      return;
    }
    if (rootA.id === rootB.id) {
      lastResults = [];
      postToUi({
        type: "ERROR",
        message: `ペア ${i + 1}: A と B には異なる対象を指定してください`,
      });
      return;
    }

    const nodesA = dedupeTextNodes(collectTextFromRoot(rootA));
    const nodesB = dedupeTextNodes(collectTextFromRoot(rootB));
    allNodes.push(...nodesA, ...nodesB);

    const diff = compareTextNodes(
      nodesA.map((n) => ({ id: n.id, characters: n.characters })),
      nodesB.map((n) => ({ id: n.id, characters: n.characters })),
      ignoreStrings,
      ignoreCategories
    );
    merged.matchedExact.push(...diff.matchedExact);
    merged.matchedPartial.push(...diff.matchedPartial);
    merged.onlyA.push(...diff.onlyA);
    merged.onlyB.push(...diff.onlyB);
  }

  const uniqueNodes = dedupeTextNodes(allNodes);
  const results = enrichResults(compareDiffToResults(merged), uniqueNodes);
  lastResults = results;

  await withHighlightMutation(async () => {
    await buildHighlightPool(resultsToHighlightItems(results));
  });

  postToUi({ type: "SEARCH_RESULT", results });
}

async function rerunSearch(): Promise<void> {
  if (mode === "compare") {
    await handleCompare();
    return;
  }
  if (mode === "image") {
    return;
  }
  await handleSearch(lastQueries);
}

async function handleFocus(keyword: string): Promise<void> {
  const result = findResultByKey(lastResults, keyword);
  if (!result) {
    return;
  }
  const matches = collectResultMatches(result);
  if (matches.length === 0) {
    return;
  }

  const nodes: SceneNode[] = [];
  for (const match of matches) {
    const node = await figma.getNodeByIdAsync(match.nodeId);
    if (node && "visible" in node) {
      nodes.push(node as SceneNode);
    }
  }

  if (nodes.length === 0) {
    return;
  }

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
}

async function handleFocusNode(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || !("visible" in node)) {
    return;
  }

  const sceneNode = node as SceneNode;
  figma.currentPage.selection = [sceneNode];
  figma.viewport.scrollAndZoomIntoView([sceneNode]);
}

figma.ui.onmessage = async (msg: UiToPluginMessage) => {
  try {
    switch (msg.type) {
      case "LIST_PIN_TARGETS":
        postPinTargets();
        break;
      case "LIST_COMPARE_TARGETS":
        postCompareState();
        break;
      case "LIST_IMAGE_TARGETS":
        postImageState();
        break;
      case "SET_MODE": {
        mode = msg.mode;

        if (mode === "pinned") {
          const targets = collectPinTargets();
          if (msg.pinnedNodeId !== undefined) {
            pinnedNodeId = msg.pinnedNodeId;
          }
          if (pinnedNodeId && !targets.some((t) => t.id === pinnedNodeId)) {
            pinnedNodeId = null;
          }
          postToUi({
            type: "PIN_TARGETS",
            targets,
            pinnedNodeId,
          });
        }

        if (mode === "compare") {
          if (msg.comparePairs !== undefined) {
            comparePairs =
              msg.comparePairs.length > 0
                ? msg.comparePairs.map((p) => ({ ...p }))
                : [emptyComparePair()];
          }
          postCompareState();
        }

        if (mode === "image") {
          if (msg.imageTargetId !== undefined) {
            imageTargetId = msg.imageTargetId;
          }
          postImageState();
        }

        await rerunSearch();
        break;
      }
      case "EXPORT_IMAGE_FROM_SELECTION":
        await handleExportImageFromSelection();
        break;
      case "CLEAR_IMAGE":
        postToUi({ type: "IMAGE_CLEARED" });
        break;
      case "SET_IMAGE_COMPARE_TARGET":
        imageTargetId = msg.targetId;
        postImageState();
        break;
      case "SET_IMAGE_TARGET_FROM_SELECTION": {
        const fromSelection = resolvePinTargetFromSelection();
        const targets = collectPinTargets();
        const nodeId =
          fromSelection && targets.some((t) => t.id === fromSelection)
            ? fromSelection
            : null;
        if (!nodeId) {
          postToUi({
            type: "ERROR",
            message: "選択から比較ターゲットを解決できません",
          });
          break;
        }
        imageTargetId = nodeId;
        postImageState();
        break;
      }
      case "RUN_IMAGE_COMPARE":
        await handleImageCompare(msg.ocrTexts, {
          imageNodeId: msg.imageNodeId,
          exportScale: msg.exportScale,
          ocrRegions: msg.ocrRegions,
          ignoreStrings: msg.ignoreStrings ?? lastIgnoreStrings,
          ignoreCategories: msg.ignoreCategories ?? lastIgnoreCategories,
        });
        break;
      case "SET_PINNED_NODE":
        pinnedNodeId = msg.pinnedNodeId;
        if (mode === "pinned") {
          await rerunSearch();
        } else {
          postPinTargets();
        }
        break;
      case "SET_PINNED_FROM_SELECTION": {
        const fromSelection = resolvePinTargetFromSelection();
        const targets = collectPinTargets();
        const nodeId =
          fromSelection && targets.some((t) => t.id === fromSelection)
            ? fromSelection
            : null;
        if (!nodeId) {
          postToUi({
            type: "ERROR",
            message: "選択から固定先を解決できません",
          });
          break;
        }
        pinnedNodeId = nodeId;
        postPinTargets();
        if (mode === "pinned") {
          await rerunSearch();
        }
        break;
      }
      case "SET_COMPARE_PAIRS":
        comparePairs =
          msg.pairs.length > 0
            ? msg.pairs.map((p) => ({ ...p }))
            : [emptyComparePair()];
        postCompareState();
        if (mode === "compare") {
          await handleCompare();
        }
        break;
      case "SET_COMPARE_PAIR": {
        while (comparePairs.length <= msg.index) {
          comparePairs.push(emptyComparePair());
        }
        const pair = comparePairs[msg.index];
        if (msg.side === "A") {
          pair.idA = msg.nodeId;
        } else {
          pair.idB = msg.nodeId;
        }
        postCompareState();
        if (mode === "compare") {
          await handleCompare();
        }
        break;
      }
      case "SET_COMPARE_FROM_SELECTION": {
        const fromSelection = resolvePinTargetFromSelection();
        const targets = collectPinTargets();
        const nodeId =
          fromSelection && targets.some((t) => t.id === fromSelection)
            ? fromSelection
            : null;
        if (!nodeId) {
          postToUi({
            type: "ERROR",
            message: "選択から比較対象を解決できません",
          });
          break;
        }
        while (comparePairs.length <= msg.index) {
          comparePairs.push(emptyComparePair());
        }
        const pair = comparePairs[msg.index];
        if (msg.side === "A") {
          pair.idA = nodeId;
        } else {
          pair.idB = nodeId;
        }
        postCompareState();
        if (mode === "compare") {
          await handleCompare();
        }
        break;
      }
      case "SEARCH":
        await handleSearch(
          msg.queries,
          msg.ignoreStrings ?? [],
          msg.ignoreCategories ?? lastIgnoreCategories
        );
        break;
      case "RUN_COMPARE":
        await handleCompare(
          msg.ignoreStrings ?? lastIgnoreStrings,
          msg.ignoreCategories ?? lastIgnoreCategories
        );
        break;
      case "FOCUS_RESULT":
        await handleFocus(msg.keyword);
        break;
      case "FOCUS_NODE":
        await handleFocusNode(msg.nodeId);
        break;
      case "BUILD_HIGHLIGHT_POOL":
        await withHighlightMutation(async () => {
          await buildHighlightPool(msg.items);
          showHoverHighlight(msg.items);
        });
        break;
      case "HOVER_HIGHLIGHT":
        await withHighlightMutation(() => {
          showHoverHighlight(msg.items);
        });
        break;
      case "CLEAR_HIGHLIGHT":
        await withHighlightMutation(() => {
          hideAllHighlights();
        });
        break;
      case "SET_HIGHLIGHT_COLOR":
        await withHighlightMutation(() => {
          recolorHighlightItems(msg.items, msg.color);
        });
        break;
      case "RESIZE_UI": {
        const height = clampUiHeight(msg.height);
        figma.ui.resize(UI_WIDTH, height);
        void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postToUi({ type: "ERROR", message: `エラーが発生しました: ${message}` });
  }
};

figma.on("selectionchange", () => {
  // Highlights may change selection; ignore those mutations.
  if (ignoreSelectionForHighlight) {
    return;
  }
});

figma.on("currentpagechange", () => {
  postPinTargets();
  if (mode === "compare") {
    postCompareState();
  }
  if (mode === "image") {
    postImageState();
  }
  void rerunSearch();
});

figma.on("close", () => {
  clearHoverHighlight();
});

postPinTargets();
