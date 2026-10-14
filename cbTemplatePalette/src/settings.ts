/**
 * この端末だけの設定。clientStorage に置く。
 */
const USE_SHARED_KEY = "cbTemplatePalette.useSharedCategories";
/** 共有カテゴリのグループの開閉。D1 の tree.json には書かない（ほかの人の開閉を変えないため）。 */
const LINKED_COLLAPSED_KEY = "cbTemplatePalette.linkedCollapsed";

/** 「共有カテゴリを使用する」。保存されていなければオフ。 */
export async function loadUseSharedCategories(): Promise<boolean> {
  return (await figma.clientStorage.getAsync(USE_SHARED_KEY)) === true;
}

export async function saveUseSharedCategories(enabled: boolean): Promise<void> {
  await figma.clientStorage.setAsync(USE_SHARED_KEY, enabled);
}

/** 共有カテゴリの id ごとの、たたんでいるグループの id。 */
export async function loadLinkedCollapsed(): Promise<Record<string, string[]>> {
  const stored = await figma.clientStorage.getAsync(LINKED_COLLAPSED_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [linkId, ids] of Object.entries(stored as Record<string, unknown>)) {
    if (Array.isArray(ids)) {
      result[linkId] = ids.filter((id): id is string => typeof id === "string");
    }
  }
  return result;
}

export async function saveLinkedCollapsed(value: Record<string, string[]>): Promise<void> {
  await figma.clientStorage.setAsync(LINKED_COLLAPSED_KEY, value);
}
