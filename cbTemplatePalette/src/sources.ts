import { D1StorageAdapter, clearD1Space, normalizeD1Source, testD1Connection, type D1TestFailure } from "./d1Storage";
import type { StorageAdapter } from "./storageAdapter";
import type { SourceConfig, StorageErrorKind } from "./types";

/** 外部の保存先。共有カテゴリを足す前に `verify` で使えるか確かめる。 */
export interface ExternalAdapter extends StorageAdapter {
  readonly source: SourceConfig;
  verify(): Promise<void>;
}

export { METADATA_KEY } from "./jsonCodec";

const D1_FAILED_MESSAGE = "Cloudflare D1 に接続できませんでした。\nWorker の URL とアクセストークンを確認してください。";
const D1_SPACE_MESSAGE = "保存先のスペースにアクセスできません。\nスペース名を確認してください。";

/** 接続テストのときだけ、原因に近い案内を出す（Worker の応答そのものは出さない）。 */
const D1_TEST_MESSAGES: Record<Exclude<D1TestFailure, StorageErrorKind>, string> = {
  unreachable: "Worker の URL に届いていません。\nURL と、Worker がデプロイされているかを確認してください。",
  wrong_worker:
    "この URL はテンプレパレット用の D1 Worker ではありません。\ncbTemplatePalette/d1-worker をデプロイした URL を入れてください。",
  r2_worker: "R2 用 Worker の URL です。\nD1 には cbTemplatePalette/d1-worker をデプロイしてください。",
  old_worker: "Worker が古い版です。\ncbTemplatePalette/d1-worker で npm run deploy を実行して更新してください。",
  server:
    "Worker 側で D1 の読み書きに失敗しました。\nmigration（npm run migrate）と database_id、Cloudflare のログを確認してください。",
};

export function sourceErrorMessage(kind: StorageErrorKind): string {
  return kind === "folder" ? D1_SPACE_MESSAGE : D1_FAILED_MESSAGE;
}

function d1TestMessage(failure: D1TestFailure): string {
  if (failure === "auth") {
    return "アクセストークンが Worker の ACCESS_TOKEN と一致しません。\nトークンを確認してください。";
  }
  if (failure === "folder" || failure === "network") {
    return sourceErrorMessage(failure);
  }
  return D1_TEST_MESSAGES[failure];
}

/** 保存先として使える形に整える。使えなければ null（以前の別の保存先の登録もここで落ちる）。 */
export function normalizeSource(value: unknown): SourceConfig | null {
  return normalizeD1Source(value);
}

export function adapterForSource(source: SourceConfig): ExternalAdapter {
  return new D1StorageAdapter(source);
}

/** 接続テスト。成功なら null、失敗なら UI に出す案内。 */
export async function testSource(source: SourceConfig): Promise<string | null> {
  const failure = await testD1Connection(source);
  return failure === null ? null : d1TestMessage(failure);
}

/** 保存先のデータを全部消す。成功なら null、失敗なら UI に出す案内。 */
export async function clearSource(source: SourceConfig): Promise<string | null> {
  const failure = await clearD1Space(source);
  return failure === null ? null : d1TestMessage(failure);
}

/** 表示用の説明。トークンは含めない。 */
export function sourceLabel(source: SourceConfig): string {
  return `${source.endpoint}（${source.space}）`;
}

/** 共有カテゴリの名前を空欄にしたときの初期値（metadata.json に名前が無いとき）。 */
export function sourceDefaultName(source: SourceConfig): string {
  return source.space;
}

export function sameSource(a: SourceConfig, b: SourceConfig): boolean {
  return a.endpoint.toLowerCase() === b.endpoint.toLowerCase() && a.space === b.space;
}
