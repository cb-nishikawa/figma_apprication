/**
 * この端末だけの設定。clientStorage に置く。
 */
const USE_SHARED_KEY = "cbTemplatePalette.useSharedCategories";

/** 「共有カテゴリを使用する」。保存されていなければオフ。 */
export async function loadUseSharedCategories(): Promise<boolean> {
  return (await figma.clientStorage.getAsync(USE_SHARED_KEY)) === true;
}

export async function saveUseSharedCategories(enabled: boolean): Promise<void> {
  await figma.clientStorage.setAsync(USE_SHARED_KEY, enabled);
}
