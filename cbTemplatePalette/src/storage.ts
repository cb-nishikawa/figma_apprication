import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import type {
  SerializedNode,
  StoredTemplateV2,
  TemplateContent,
  TemplateItem,
  TemplateMeta,
} from "./types";

const INDEX_KEY = "cbTemplatePalette.index";
const ITEM_PREFIX = "cbTemplatePalette.item.";

/** clientStorage allows roughly 5MB per plugin. */
export const QUOTA_BYTES = 5 * 1024 * 1024;

function itemKey(id: string): string {
  return `${ITEM_PREFIX}${id}`;
}

export async function loadIndex(): Promise<TemplateMeta[]> {
  const stored = await figma.clientStorage.getAsync(INDEX_KEY);
  return Array.isArray(stored) ? (stored as TemplateMeta[]) : [];
}

async function saveIndex(index: TemplateMeta[]): Promise<void> {
  await figma.clientStorage.setAsync(INDEX_KEY, index);
}

export async function loadItem(id: string): Promise<TemplateItem | null> {
  const stored = await figma.clientStorage.getAsync(itemKey(id));
  if (!stored || typeof stored !== "object") {
    return null;
  }
  return stored as TemplateItem;
}

export function usedBytes(index: TemplateMeta[]): number {
  return index.reduce((sum, meta) => sum + (meta.byteSize || 0), 0);
}

export function encodeItem(
  roots: SerializedNode[],
  components?: Record<string, SerializedNode>
): StoredTemplateV2 {
  const body: TemplateContent = { roots };
  if (components && Object.keys(components).length > 0) {
    body.components = components;
  }
  return { version: 2, data: gzipSync(strToU8(JSON.stringify(body))) };
}

export function decodeItem(item: TemplateItem): TemplateContent {
  if (item.version === 1) {
    return { roots: item.roots };
  }
  const parsed = JSON.parse(strFromU8(gunzipSync(new Uint8Array(item.data)))) as Partial<TemplateContent>;
  return {
    roots: Array.isArray(parsed.roots) ? parsed.roots : [],
    components: parsed.components && typeof parsed.components === "object" ? parsed.components : undefined,
  };
}

export function estimateBytes(item: StoredTemplateV2, thumbnail: string): number {
  return item.data.length + thumbnail.length;
}

export class QuotaExceededError extends Error {
  constructor() {
    super("保存容量の上限（約 5MB）を超えるため保存できません。不要なテンプレートを削除してください");
  }
}

export async function saveTemplate(meta: TemplateMeta, item: TemplateItem): Promise<TemplateMeta[]> {
  const index = await loadIndex();
  if (usedBytes(index) + meta.byteSize > QUOTA_BYTES) {
    throw new QuotaExceededError();
  }
  await figma.clientStorage.setAsync(itemKey(meta.id), item);
  const next = [meta, ...index];
  try {
    await saveIndex(next);
  } catch (err) {
    await figma.clientStorage.deleteAsync(itemKey(meta.id));
    throw err;
  }
  return next;
}

export async function deleteTemplate(id: string): Promise<TemplateMeta[]> {
  const next = (await loadIndex()).filter((meta) => meta.id !== id);
  await saveIndex(next);
  await figma.clientStorage.deleteAsync(itemKey(id));
  return next;
}

/** Re-reads the index so concurrent saves or deletes are not overwritten. */
export async function updateTemplate(
  id: string,
  patch: Partial<Omit<TemplateMeta, "id">>,
  item?: TemplateItem
): Promise<TemplateMeta[]> {
  const index = await loadIndex();
  if (!index.some((meta) => meta.id === id)) {
    return index;
  }
  if (item) {
    await figma.clientStorage.setAsync(itemKey(id), item);
  }
  const next = index.map((meta) => (meta.id === id ? { ...meta, ...patch } : meta));
  await saveIndex(next);
  return next;
}

export async function renameTemplate(id: string, name: string): Promise<TemplateMeta[]> {
  const next = (await loadIndex()).map((meta) =>
    meta.id === id ? { ...meta, name } : meta
  );
  await saveIndex(next);
  return next;
}
