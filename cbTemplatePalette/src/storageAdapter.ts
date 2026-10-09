import type { StorageErrorKind, StorageType } from "./types";

/**
 * テンプレートの保存先。storage.ts はこの get / set / remove だけを使い、
 * どこに保存するか（端末の clientStorage か共有カテゴリの R2 か）は知らない。
 */
export interface StorageAdapter {
  readonly type: StorageType;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** 保存できる上限。上限が無い保存先は null。 */
  readonly quotaBytes: number | null;
}

/**
 * 外部の保存先に届かないときのエラー。API の詳しい内容は持たせず、種類だけを UI に伝える。
 * - auth: アクセストークンが違う・取り消された
 * - folder: スペースが無い・使えない名前
 * - network: 通信できない・一時的なエラー
 */
export class StorageAccessError extends Error {
  /** どの保存先で起きたか。文言を保存先ごとに変えるため、呼び出し側（stores.ts）が付ける。 */
  provider?: StorageType;
  /** 共有カテゴリで起きたときのカテゴリ名。 */
  category?: string;

  constructor(readonly kind: StorageErrorKind) {
    super(`storage:${kind}`);
  }
}

/** clientStorage allows roughly 5MB per plugin. */
export const LOCAL_QUOTA_BYTES = 5 * 1024 * 1024;

/** これまでどおりの保存先。figma.clientStorage をそのまま呼ぶ。 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly type = "local" as const;
  readonly quotaBytes = LOCAL_QUOTA_BYTES;

  get(key: string): Promise<unknown> {
    return figma.clientStorage.getAsync(key);
  }

  set(key: string, value: unknown): Promise<void> {
    return figma.clientStorage.setAsync(key, value);
  }

  remove(key: string): Promise<void> {
    return figma.clientStorage.deleteAsync(key);
  }
}

let current: StorageAdapter = new LocalStorageAdapter();

/** 今使っている保存先。起動直後は必ずローカル。 */
export function storage(): StorageAdapter {
  return current;
}

export function useAdapter(adapter: StorageAdapter): void {
  current = adapter;
}
