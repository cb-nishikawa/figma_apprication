import { collectImageTargets, selectedFrames } from "./collectImages";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type { ExportFormat, ExportRequest, ExportResultItem, ImageListItem } from "./types";

const UI_WIDTH = 360;
const MIN_UI_HEIGHT = 320;
const MAX_UI_HEIGHT = 900;
const DEFAULT_UI_HEIGHT = 480;
const UI_HEIGHT_STORAGE_KEY = "cbImageExport.uiHeight";
const THUMB_WIDTH = 80;

function clampUiHeight(height: number): number {
  return Math.min(MAX_UI_HEIGHT, Math.max(MIN_UI_HEIGHT, Math.round(height)));
}

function postToUi(msg: PluginToUiMessage): void {
  figma.ui.postMessage(msg);
}

async function makeThumb(node: SceneNode): Promise<number[] | undefined> {
  if (!("exportAsync" in node)) {
    return undefined;
  }
  try {
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: THUMB_WIDTH },
    });
    return Array.from(bytes);
  } catch {
    return undefined;
  }
}

async function scanSelection(): Promise<void> {
  const frames = selectedFrames();
  if (frames.length === 0) {
    postToUi({
      type: "IMAGE_LIST",
      items: [],
      frameNames: [],
      message: "フレームを選択してください",
    });
    return;
  }

  const collected = collectImageTargets(frames);
  const items: ImageListItem[] = [];
  for (const entry of collected) {
    const thumbBytes = await makeThumb(entry.target);
    items.push({
      id: entry.target.id,
      name: entry.target.name || "(untitled)",
      parentName: entry.parentName,
      thumbBytes,
    });
  }

  postToUi({
    type: "IMAGE_LIST",
    items,
    frameNames: frames.map((f) => f.name || "(untitled)"),
    message:
      items.length === 0
        ? "表示中の画像が見つかりませんでした"
        : undefined,
  });
}

function exportSettings(
  format: ExportFormat,
  scale: number
): ExportSettings {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (format === "JPG") {
    return {
      format: "JPG",
      constraint: { type: "SCALE", value: safeScale },
      contentsOnly: true,
    };
  }
  if (format === "PNG") {
    return {
      format: "PNG",
      constraint: { type: "SCALE", value: safeScale },
      contentsOnly: true,
    };
  }
  if (format === "SVG") {
    return {
      format: "SVG",
      contentsOnly: true,
    };
  }
  return {
    format: "PDF",
    contentsOnly: true,
  };
}

async function exportNodes(requests: ExportRequest[]): Promise<void> {
  const results: ExportResultItem[] = [];
  for (const req of requests) {
    const node = await figma.getNodeByIdAsync(req.id);
    if (!node || !("exportAsync" in node)) {
      results.push({
        id: req.id,
        name: "(missing)",
        format: req.format,
        ok: false,
        message: "ノードが見つからないか書き出せません",
      });
      continue;
    }
    const scene = node as SceneNode;
    try {
      const bytes = await scene.exportAsync(exportSettings(req.format, req.scale));
      results.push({
        id: req.id,
        name: scene.name || "(untitled)",
        format: req.format,
        ok: true,
        bytes: Array.from(bytes),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: req.id,
        name: scene.name || "(untitled)",
        format: req.format,
        ok: false,
        message: `${req.format} 書き出しに失敗: ${message}`,
      });
    }
  }
  postToUi({ type: "EXPORT_RESULT", results });
}

async function focusNode(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || !("x" in node)) {
    return;
  }
  const scene = node as SceneNode;
  figma.currentPage.selection = [scene];
  figma.viewport.scrollAndZoomIntoView([scene]);
}

async function initUiHeight(): Promise<number> {
  const stored = await figma.clientStorage.getAsync(UI_HEIGHT_STORAGE_KEY);
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return clampUiHeight(stored);
  }
  return DEFAULT_UI_HEIGHT;
}

async function main(): Promise<void> {
  const uiHeight = await initUiHeight();
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: uiHeight,
    themeColors: true,
  });

  figma.ui.onmessage = async (raw: UiToPluginMessage) => {
    try {
      switch (raw.type) {
        case "SCAN_SELECTION":
          await scanSelection();
          break;
        case "FOCUS_NODE":
          await focusNode(raw.nodeId);
          break;
        case "EXPORT_NODES":
          await exportNodes(raw.items);
          break;
        case "RESIZE_UI": {
          const height = clampUiHeight(raw.height);
          figma.ui.resize(UI_WIDTH, height);
          void figma.clientStorage.setAsync(UI_HEIGHT_STORAGE_KEY, height);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      postToUi({ type: "ERROR", message });
    }
  };

  figma.on("selectionchange", () => {
    void scanSelection();
  });

  void scanSelection();
}

void main();
