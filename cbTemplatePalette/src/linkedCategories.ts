import { normalizeSource, sourceLabel } from "./sources";
import type { LinkedCategory, LinkedCategoryInfo } from "./types";

/**
 * 共有カテゴリの登録。端末ごとの設定なので clientStorage に置く。
 * D1 のスペースとして読めない登録（以前の別の保存先のものなど）は読み飛ばす（消しはしない）。
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

/** 読み飛ばした登録はそのまま残して保存する。 */
export async function saveLinkedCategories(links: LinkedCategory[]): Promise<void> {
  const stored = await figma.clientStorage.getAsync(LINKED_KEY);
  const unreadable = Array.isArray(stored)
    ? (stored as Array<Partial<LinkedCategory>>).filter((entry) => !normalizeSource(entry?.source))
    : [];
  await figma.clientStorage.setAsync(LINKED_KEY, [...unreadable, ...links]);
}

export function linkedInfo(links: LinkedCategory[]): LinkedCategoryInfo[] {
  return links.map((link) => ({ name: link.name, provider: link.source.provider, label: sourceLabel(link.source) }));
}
