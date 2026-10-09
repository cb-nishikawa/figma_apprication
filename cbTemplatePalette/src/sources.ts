import { R2StorageAdapter, normalizeR2Source, testR2Connection } from "./r2Storage";
import type { StorageAdapter } from "./storageAdapter";
import type { SourceConfig, StorageErrorKind } from "./types";

/** 外部の保存先。共有カテゴリを足す前に `verify` で使えるか確かめる。 */
export interface ExternalAdapter extends StorageAdapter {
  readonly source: SourceConfig;
  verify(): Promise<void>;
}

/** 印（metadata.json）のキー。jsonCodec の locate で `metadata.json` になる。 */
export const METADATA_KEY = "metadata";

const R2_FAILED_MESSAGE = "Cloudflare R2 に接続できませんでした。\nWorker の URL とアクセストークンを確認してください。";
const R2_SPACE_MESSAGE = "保存先のスペースにアクセスできません。\nスペース名を確認してください。";

export function sourceErrorMessage(kind: StorageErrorKind): string {
  return kind === "folder" ? R2_SPACE_MESSAGE : R2_FAILED_MESSAGE;
}

/** 保存先として使える形に整える。使えなければ null。 */
export function normalizeSource(value: unknown): SourceConfig | null {
  return (value as SourceConfig | null)?.provider === "r2" ? normalizeR2Source(value) : null;
}

export function adapterForSource(source: SourceConfig): ExternalAdapter {
  return new R2StorageAdapter(source);
}

/** 接続テスト。成功なら null。 */
export function testSource(source: SourceConfig): Promise<StorageErrorKind | null> {
  return testR2Connection(source);
}

/** 表示用の説明。トークンは含めない。 */
export function sourceLabel(source: SourceConfig): string {
  return `${source.space}（${source.endpoint.replace(/^https?:\/\//, "")}）`;
}

export function sameSource(a: SourceConfig, b: SourceConfig): boolean {
  return a.endpoint === b.endpoint && a.space === b.space;
}
