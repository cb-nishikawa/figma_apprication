import { D1StorageAdapter, normalizeD1Source, testD1Connection, type D1TestFailure } from "./d1Storage";
import type { DropboxTokens } from "./dropboxAuth";
import { DropboxStorageAdapter, normalizeDropboxSource, testDropboxConnection } from "./dropboxStorage";
import type { StorageAdapter } from "./storageAdapter";
import type { SourceConfig, StorageErrorKind, StorageType } from "./types";

/** 外部の保存先。共有カテゴリを足す前に `verify` で使えるか確かめる。 */
export interface ExternalAdapter extends StorageAdapter {
  readonly source: SourceConfig;
  verify(): Promise<void>;
}

/** 印（metadata.json）のキー。jsonCodec の locate で `metadata.json` になる。 */
export const METADATA_KEY = "metadata";

const DROPBOX_FAILED_MESSAGE = "Dropbox に接続できませんでした。\n接続し直してください。";
const DROPBOX_FOLDER_MESSAGE = "保存先フォルダにアクセスできません。\nフォルダを選び直してください。";
const D1_FAILED_MESSAGE = "Cloudflare D1 に接続できませんでした。\nWorker の URL とアクセストークンを確認してください。";
const D1_SPACE_MESSAGE = "保存先のスペースにアクセスできません。\nスペース名を確認してください。";

/** 接続テストのときだけ、原因に近い案内を出す（Worker の応答そのものは出さない）。 */
const D1_TEST_MESSAGES: Record<Exclude<D1TestFailure, StorageErrorKind>, string> = {
  unreachable: "Worker の URL に届いていません。\nURL と、Worker がデプロイされているかを確認してください。",
  wrong_worker:
    "この URL はテンプレパレット用の D1 Worker ではありません。\ncbTemplatePalette/d1-worker をデプロイした URL を入れてください。",
  r2_worker: "R2 用 Worker の URL です。\nD1 には cbTemplatePalette/d1-worker をデプロイしてください。",
  server:
    "Worker 側で D1 の読み書きに失敗しました。\nmigration（npm run migrate）と database_id、Cloudflare のログを確認してください。",
};

function d1TestMessage(failure: D1TestFailure): string {
  if (failure === "auth") {
    return "アクセストークンが Worker の ACCESS_TOKEN と一致しません。\nトークンを確認してください。";
  }
  if (failure === "folder" || failure === "network") {
    return sourceErrorMessage(failure, "d1");
  }
  return D1_TEST_MESSAGES[failure];
}

export function sourceErrorMessage(kind: StorageErrorKind, provider?: StorageType): string {
  if (provider === "d1") {
    return kind === "folder" ? D1_SPACE_MESSAGE : D1_FAILED_MESSAGE;
  }
  return kind === "folder" ? DROPBOX_FOLDER_MESSAGE : DROPBOX_FAILED_MESSAGE;
}

/** 保存先として使える形に整える。使えなければ null。 */
export function normalizeSource(value: unknown): SourceConfig | null {
  return normalizeDropboxSource(value) ?? normalizeD1Source(value);
}

/** Dropbox は未接続でも作る（使うときに auth のエラーになる）。黙ってローカルに戻さないため。 */
export function adapterForSource(source: SourceConfig, tokens: DropboxTokens | null): ExternalAdapter {
  return source.provider === "d1" ? new D1StorageAdapter(source) : new DropboxStorageAdapter(source, tokens);
}

/** 接続テスト。成功なら null、失敗なら UI に出す案内。 */
export async function testSource(source: SourceConfig, tokens: DropboxTokens | null): Promise<string | null> {
  if (source.provider === "d1") {
    const failure = await testD1Connection(source);
    return failure === null ? null : d1TestMessage(failure);
  }
  const failure = await testDropboxConnection(tokens, source);
  return failure === null ? null : sourceErrorMessage(failure, "dropbox");
}

/** 表示用の説明。トークンは含めない。 */
export function sourceLabel(source: SourceConfig): string {
  return source.provider === "d1" ? `${source.endpoint}（${source.space}）` : source.path;
}

/** 共有カテゴリの名前を空欄にしたときの初期値（metadata.json に名前が無いとき）。 */
export function sourceDefaultName(source: SourceConfig): string {
  return source.provider === "d1" ? source.space : source.label;
}

export function sameSource(a: SourceConfig, b: SourceConfig): boolean {
  if (a.provider === "d1" || b.provider === "d1") {
    return (
      a.provider === "d1" &&
      b.provider === "d1" &&
      a.endpoint.toLowerCase() === b.endpoint.toLowerCase() &&
      a.space === b.space
    );
  }
  if (a.namespaceId || b.namespaceId) {
    return a.namespaceId === b.namespaceId;
  }
  return a.path.toLowerCase() === b.path.toLowerCase();
}
