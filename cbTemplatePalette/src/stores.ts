import { linkedInfo, loadLinkedCategories, saveLinkedCategories } from "./linkedCategories";
import { adapterForSource } from "./sources";
import { LocalStorageAdapter, StorageAccessError, useAdapter, type StorageAdapter } from "./storageAdapter";
import type { LinkedCategory, LinkedCategoryInfo } from "./types";

/**
 * どの保存先を使うかを決める。
 *
 * - 「未設定」と普通のカテゴリは、常に端末の clientStorage（ローカル）に入る
 * - 共有カテゴリは 1 つが外部の保存先 1 つ。中身はその保存先に入る
 *
 * storage.ts は `storage()` の 1 つだけを見るので、ストレージを触る処理は `enqueue` で 1 つずつ流し、
 * 処理中だけ `useStore` / `withStore` で差し替える（並行して走ると別の保存先に書いてしまうため）。
 */

export interface Store {
  /** `home` か `link:<id>`。サムネイルの作り直しなど、保存先ごとの印に使う。 */
  key: string;
  adapter: StorageAdapter;
  link: LinkedCategory | null;
}

let linked: LinkedCategory[] = [];
const home: Store = { key: "home", adapter: new LocalStorageAdapter(), link: null };
const linkStores = new Map<string, Store>();
/** UI で今選んでいるカテゴリ。空文字は「未設定」。 */
let viewCategory = "";
let active: Store = home;
let queue: Promise<void> = Promise.resolve();

/** 共有カテゴリが変わったら作り直す。走っている処理の保存先は差し替えない。 */
function rebuild(): void {
  linkStores.clear();
  for (const link of linked) {
    linkStores.set(link.id, { key: `link:${link.id}`, adapter: adapterForSource(link.source), link });
  }
}

export async function initStores(): Promise<void> {
  try {
    linked = await loadLinkedCategories();
  } catch {
    linked = [];
  }
  rebuild();
}

export function linkedCategories(): LinkedCategory[] {
  return linked;
}

export function linkedCategoryInfo(): LinkedCategoryInfo[] {
  return linkedInfo(linked);
}

export async function setLinkedCategories(next: LinkedCategory[]): Promise<void> {
  await saveLinkedCategories(next);
  linked = next;
  rebuild();
}

export function homeStore(): Store {
  return home;
}

export function linkByName(name: string | null | undefined): LinkedCategory | undefined {
  const trimmed = name?.trim();
  return trimmed ? linked.find((link) => link.name === trimmed) : undefined;
}

/** そのカテゴリのテンプレートを置く保存先。共有カテゴリでなければローカル。 */
export function storeForCategory(category: string | null | undefined): Store {
  const link = linkByName(category);
  return (link && linkStores.get(link.id)) || home;
}

export function setViewCategory(category: string): void {
  viewCategory = category.trim();
}

export function currentViewCategory(): string {
  return viewCategory;
}

export function viewStore(): Store {
  return storeForCategory(viewCategory);
}

export function activeStore(): Store {
  return active;
}

export function useStore(store: Store): void {
  active = store;
  useAdapter(store.adapter);
}

/** エラーに保存先の種類と共有カテゴリ名を付ける（文言を分けるため）。 */
function annotate(err: unknown, store: Store): void {
  if (err instanceof StorageAccessError && !err.provider) {
    err.provider = store.adapter.type;
    err.category = store.link?.name;
  }
}

/** 別の保存先で処理する。キューの中（1 つずつ流している間）でだけ使う。 */
export async function withStore<T>(store: Store, task: () => Promise<T>): Promise<T> {
  const previous = active;
  useStore(store);
  try {
    return await task();
  } catch (err) {
    annotate(err, store);
    throw err;
  } finally {
    useStore(previous);
  }
}

/** ストレージを触る処理を 1 つずつ流す。今見ている保存先で始める。 */
export function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(() => withStore(viewStore(), task));
  queue = run.catch(() => undefined);
  return run;
}
