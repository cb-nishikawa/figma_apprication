import { normalizeSource, sourceLabel } from "./sources";
import type { LinkedCategory, LinkedCategoryInfo } from "./types";

/**
 * 共有カテゴリの登録。R2 の合言葉を含み、端末ごとの設定なので clientStorage に置く。
 * R2 として読めない登録は読み飛ばす。
 */
const LINKED_KEY = "cbTemplatePalette.linkedCategories";

export async function loadLinkedCategories(): Promise<LinkedCategory[]> {
  const stored = await figma.clientStorage.getAsync(LINKED_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }
  const result: LinkedCategory[] = [];
  for (const entry of stored as Array<Partial<LinkedCategory>>) {
    const source = normalizeSource(entry?.source);
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (source && name && typeof entry.id === "string" && !result.some((link) => link.name === name)) {
      result.push({ id: entry.id, name, source });
    }
  }
  return result;
}

export async function saveLinkedCategories(links: LinkedCategory[]): Promise<void> {
  await figma.clientStorage.setAsync(LINKED_KEY, links);
}

export function linkedInfo(links: LinkedCategory[]): LinkedCategoryInfo[] {
  return links.map((link) => ({ name: link.name, provider: link.source.provider, label: sourceLabel(link.source) }));
}
