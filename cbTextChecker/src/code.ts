import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type { CheckResult, KeywordQuery, SearchMode } from "./types";
import { clearHoverHighlight, showHoverHighlight } from "./highlight";
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
const SELECTION_DEBOUNCE_MS = 150;

let mode: SearchMode = "selection";
let pinnedNodeId: string | null = null;
let lastQueries: KeywordQuery[] = [];
let lastResults: CheckResult[] = [];
let selectionTimer: ReturnType<typeof setTimeout> | null = null;
/** Skip selection-driven re-search while creating/removing highlight overlays. */
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

function isPinTargetNode(node: BaseNode): node is FrameNode | SectionNode {
  return node.type === "FRAME" || node.type === "SECTION";
}

function collectTextFromRoot(root: BaseNode & ChildrenMixin): TextNode[] {
  return root.findAll((n) => n.type === "TEXT") as TextNode[];
}

function collectTextFromSelection(selection: readonly SceneNode[]): TextNode[] {
  const texts: TextNode[] = [];
  for (const node of selection) {
    if (node.type === "TEXT") {
      texts.push(node);
      continue;
    }
    if ("findAll" in node) {
      texts.push(...collectTextFromRoot(node as BaseNode & ChildrenMixin));
    }
  }
  return dedupeTextNodes(texts);
}

function makePreview(characters: string): string {
  const flat = characters.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX_LENGTH) {
    return flat;
  }
  return `${flat.slice(0, PREVIEW_MAX_LENGTH)}…`;
}

function enrichResults(
  results: CheckResult[],
  nodes: TextNode[]
): CheckResult[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  return results.map((result) => ({
    ...result,
    matches: result.matches.map((match) => {
      const node = nodeById.get(match.nodeId);
      return {
        ...match,
        nodeName: node?.name || "(untitled)",
        preview: makePreview(node?.characters ?? ""),
      };
    }),
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

/** Prefer selected SECTION/FRAME, else nearest SECTION/FRAME ancestor. */
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
  if (mode === "selection") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      return { error: "選択がありません" };
    }
    return collectTextFromSelection(selection);
  }

  if (mode === "page") {
    return figma.currentPage.findAll((n) => n.type === "TEXT") as TextNode[];
  }

  // pinned
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

async function handleSearch(queries: KeywordQuery[]): Promise<void> {
  clearHoverHighlight();
  lastQueries = queries;

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
    queries
  );

  const results = enrichResults(rawResults, nodes);
  lastResults = results;
  postToUi({ type: "SEARCH_RESULT", results });
}

async function rerunSearch(): Promise<void> {
  await handleSearch(lastQueries);
}

async function handleFocus(keyword: string): Promise<void> {
  const result = lastResults.find((r) => r.keyword === keyword);
  if (!result || result.matches.length === 0) {
    return;
  }

  const nodes: SceneNode[] = [];
  for (const match of result.matches) {
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

function scheduleSelectionSearch(): void {
  if (selectionTimer !== null) {
    clearTimeout(selectionTimer);
  }
  selectionTimer = setTimeout(() => {
    selectionTimer = null;
    void rerunSearch();
  }, SELECTION_DEBOUNCE_MS);
}

figma.ui.onmessage = async (msg: UiToPluginMessage) => {
  try {
    switch (msg.type) {
      case "LIST_PIN_TARGETS":
        postPinTargets();
        break;
      case "SET_MODE": {
        const previousMode = mode;
        mode = msg.mode;

        if (mode === "pinned") {
          const targets = collectPinTargets();

          if (previousMode === "selection") {
            const fromSelection = resolvePinTargetFromSelection();
            pinnedNodeId =
              fromSelection && targets.some((t) => t.id === fromSelection)
                ? fromSelection
                : null;
          } else if (msg.pinnedNodeId !== undefined) {
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

        await rerunSearch();
        break;
      }
      case "SET_PINNED_NODE":
        pinnedNodeId = msg.pinnedNodeId;
        if (mode === "pinned") {
          await rerunSearch();
        } else {
          postPinTargets();
        }
        break;
      case "SEARCH":
        await handleSearch(msg.queries);
        break;
      case "FOCUS_RESULT":
        await handleFocus(msg.keyword);
        break;
      case "FOCUS_NODE":
        await handleFocusNode(msg.nodeId);
        break;
      case "HOVER_HIGHLIGHT":
        await withHighlightMutation(() => showHoverHighlight(msg.items));
        break;
      case "CLEAR_HIGHLIGHT":
        await withHighlightMutation(() => {
          clearHoverHighlight();
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
  if (ignoreSelectionForHighlight) {
    return;
  }
  if (mode === "selection") {
    scheduleSelectionSearch();
  }
});

figma.on("currentpagechange", () => {
  postPinTargets();
  void rerunSearch();
});

figma.on("close", () => {
  clearHoverHighlight();
});

postPinTargets();
