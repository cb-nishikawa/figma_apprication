import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { LOCAL_QUOTA_BYTES, storage } from "./storageAdapter";
import { dropGroup, prependItem, reconcileTree, removeItems } from "./tree";
import type {
  ListNode,
  SerializedNode,
  StoredTemplateV2,
  StoredTemplateV3,
  TemplateContent,
  TemplateItem,
  TemplateMeta,
} from "./types";

const INDEX_KEY = "cbTemplatePalette.index";
const ITEM_PREFIX = "cbTemplatePalette.item.";
const TREE_KEY = "cbTemplatePalette.tree";
/** まだ誰も使っていないカテゴリも残すため、index とは別に名前だけで持つ。 */
const CATEGORIES_KEY = "cbTemplatePalette.categories";

/** clientStorage allows roughly 5MB per plugin. */
export const QUOTA_BYTES = LOCAL_QUOTA_BYTES;

function itemKey(id: string): string {
  return `${ITEM_PREFIX}${id}`;
}

export async function loadIndex(): Promise<TemplateMeta[]> {
  const stored = await storage().get(INDEX_KEY);
  return Array.isArray(stored) ? (stored as TemplateMeta[]) : [];
}

async function saveIndex(index: TemplateMeta[]): Promise<void> {
  await storage().set(INDEX_KEY, index);
}

/**
 * List order and group membership, keyed separately from the index because the
 * index only knows about templates. Read through `reconcileTree` so a tree that
 * is older than the index (templates saved before groups existed, or saved by
 * another window at the same time) still lists every template.
 */
export async function loadTree(index: TemplateMeta[]): Promise<ListNode[]> {
  const stored = await storage().get(TREE_KEY);
  return reconcileTree(isListNodeArray(stored) ? stored : [], index.map((meta) => meta.id));
}

export async function saveTree(tree: ListNode[]): Promise<ListNode[]> {
  await storage().set(TREE_KEY, tree);
  return tree;
}

function isListNodeArray(value: unknown): value is ListNode[] {
  return (
    Array.isArray(value) &&
    value.every(
      (node) =>
        node &&
        typeof node === "object" &&
        typeof node.id === "string" &&
        (node.type === "item" ||
          (node.type === "group" &&
            typeof node.name === "string" &&
            Array.isArray(node.items) &&
            (node.category === undefined || typeof node.category === "string")))
    )
  );
}

export async function loadItem(id: string): Promise<TemplateItem | null> {
  const stored = await storage().get(itemKey(id));
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
  components?: Record<string, SerializedNode>,
  images?: Record<string, Uint8Array>
): StoredTemplateV3 {
  const body: TemplateContent = { roots };
  if (components && Object.keys(components).length > 0) {
    body.components = components;
  }
  const item: StoredTemplateV3 = { version: 3, data: gzipSync(strToU8(JSON.stringify(body))) };
  if (images && Object.keys(images).length > 0) {
    item.images = images;
  }
  return item;
}

export function decodeItem(item: TemplateItem): TemplateContent {
  if (item.version === 1) {
    // v1 は画像バイトを残していたので、あればそのまま復帰に使う。
    return { roots: item.roots, images: normalizeImages(item.images) };
  }
  const parsed = JSON.parse(strFromU8(gunzipSync(new Uint8Array(item.data)))) as Partial<TemplateContent>;
  const content: TemplateContent = {
    roots: Array.isArray(parsed.roots) ? parsed.roots : [],
    components: parsed.components && typeof parsed.components === "object" ? parsed.components : undefined,
  };
  const images = item.version === 3 ? normalizeImages(item.images) : undefined;
  if (images) {
    content.images = images;
  }
  return content;
}

function normalizeImages(
  images: Record<string, Uint8Array> | undefined
): Record<string, Uint8Array> | undefined {
  if (!images || typeof images !== "object") {
    return undefined;
  }
  const entries = Object.entries(images).filter(
    (entry): entry is [string, Uint8Array] =>
      entry[0].length > 0 && entry[1] instanceof Uint8Array && entry[1].byteLength > 0
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function estimateBytes(
  item: StoredTemplateV2 | StoredTemplateV3,
  thumbnail: string
): number {
  const images = item.version === 3 ? normalizeImages(item.images) : undefined;
  const imageBytes = images
    ? Object.values(images).reduce((sum, bytes) => sum + bytes.byteLength, 0)
    : 0;
  return item.data.length + imageBytes + thumbnail.length;
}

export class QuotaExceededError extends Error {
  constructor() {
    super("保存容量の上限（約 5MB）を超えるため保存できません。不要なテンプレートを削除してください");
  }
}

export async function saveTemplate(meta: TemplateMeta, item: TemplateItem): Promise<TemplateMeta[]> {
  const index = await loadIndex();
  const quota = storage().quotaBytes;
  if (quota !== null && usedBytes(index) + meta.byteSize > quota) {
    throw new QuotaExceededError();
  }
  await storage().set(itemKey(meta.id), item);
  const next = [meta, ...index];
  try {
    await saveIndex(next);
  } catch (err) {
    await storage().remove(itemKey(meta.id));
    throw err;
  }
  // After the index, so a rejected save cannot leave an entry that points at nothing.
  await saveTree(prependItem(await loadTree(next), meta.id));
  return next;
}

/** Deletes many templates in one go, so the index and the tree are written once. */
export async function deleteTemplates(
  ids: string[],
  dropGroups: string[] = []
): Promise<TemplateMeta[]> {
  const gone = new Set(ids);
  const next = (await loadIndex()).filter((meta) => !gone.has(meta.id));
  await saveIndex(next);
  await Promise.all([...gone].map((id) => storage().remove(itemKey(id))));
  const kept = removeItems(await loadTree(next), ...gone);
  await saveTree(dropGroups.reduce(dropGroup, kept));
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
    await storage().set(itemKey(id), item);
  }
  const next = index.map((meta) => (meta.id === id ? { ...meta, ...patch } : meta));
  await saveIndex(next);
  return next;
}

/* ------------------------------ カテゴリ ------------------------------ */

/** レジストリにあるカテゴリ。まだ誰も使っていないものもここで残る。 */
export async function loadCategories(): Promise<string[]> {
  const stored = await storage().get(CATEGORIES_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

async function saveCategories(names: string[]): Promise<string[]> {
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ""))];
  await storage().set(CATEGORIES_KEY, unique);
  return unique;
}

/**
 * 一覧に並べるカテゴリ。レジストリと、テンプレート・グループが実際に持つ
 * `category` を合わせて返す。ファイルから持ってきたカテゴリも見えるようにしてある。
 */
export async function listCategories(index: TemplateMeta[], tree: ListNode[] = []): Promise<string[]> {
  const registered = await loadCategories();
  const used = index
    .map((meta) => meta.category)
    .filter((name): name is string => typeof name === "string" && name !== "");
  const groupCategories = tree
    .map((node) => (node.type === "group" ? node.category : undefined))
    .filter((name): name is string => typeof name === "string" && name !== "");
  return [...new Set([...registered, ...used, ...groupCategories])];
}

/** まだ誰も使っていないカテゴリを 1 つ足す。同じ名前があればそのまま。 */
export async function addCategory(name: string): Promise<string[]> {
  return saveCategories([...(await loadCategories()), name]);
}

/** レジストリから名前を外す。テンプレートやグループには触れない。 */
export async function removeCategory(name: string): Promise<string[]> {
  return saveCategories((await loadCategories()).filter((entry) => entry !== name));
}

/** 複数のテンプレートの `category` を 1 回の保存で書き換える。未設定はキーを落とす。 */
export async function setTemplatesCategory(
  ids: string[],
  category?: string
): Promise<TemplateMeta[]> {
  const index = await loadIndex();
  const targets = new Set(ids);
  if (!index.some((meta) => targets.has(meta.id))) {
    return index;
  }
  const next = index.map((meta) => {
    if (!targets.has(meta.id)) {
      return meta;
    }
    if (category) {
      return { ...meta, category };
    }
    const rest = { ...meta };
    delete rest.category;
    return rest;
  });
  await saveIndex(next);
  return next;
}

/** レジストリの名前を付け替え、テンプレートの `category` もまとめて付け替える。 */
export async function renameCategory(from: string, to: string): Promise<TemplateMeta[]> {
  const registered = await loadCategories();
  await saveCategories([...registered.map((name) => (name === from ? to : name)), to]);
  const index = await loadIndex();
  const tree = await loadTree(index);
  const next = index.map((meta) => (meta.category === from ? { ...meta, category: to } : meta));
  await saveIndex(next);
  if (tree.some((node) => node.type === "group" && node.category === from)) {
    await saveTree(
      tree.map((node) => (node.type === "group" && node.category === from ? { ...node, category: to } : node))
    );
  }
  return next;
}
