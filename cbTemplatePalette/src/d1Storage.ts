import { METADATA_FILE, TEST_FILE, decodeValue, encodeValue, isMetadata, locatePath, newMetadata } from "./jsonCodec";
import { StorageAccessError, type StorageAdapter } from "./storageAdapter";
import type { D1Source, StorageErrorKind } from "./types";

/**
 * Cloudflare D1 の保存先。ユーザー（チーム）が自分で立てた Worker（cbTemplatePalette/d1-worker）に
 * キーごとの JSON を置く。ファイル構成は jsonCodec.ts。
 * D1 や Cloudflare の認証情報はプラグインに置かず、Worker の合言葉（token）だけを送る。
 */

const PING_APP = "cbTemplatePalette-d1";
/** 削除した R2 用 Worker の ping。URL を取り違えたときの案内に使う。 */
const R2_PING_APP = "cbTemplatePalette-r2";
const SPACE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
/** 1 回の操作の中で何度も読む index や tree を、取りに行かずに返す時間。 */
const VALUE_CACHE_MS = 5000;

/** 入力された D1 の設定を整える。使えない値なら null。 */
export function normalizeD1Source(value: unknown): D1Source | null {
  const source = value as Partial<D1Source> | null;
  if (!source || typeof source !== "object" || source.provider !== "d1") {
    return null;
  }
  const endpoint = typeof source.endpoint === "string" ? source.endpoint.trim().replace(/\/+$/, "") : "";
  const token = typeof source.token === "string" ? source.token.trim() : "";
  const space = typeof source.space === "string" && source.space.trim() ? source.space.trim() : "default";
  const secure = /^https:\/\/[^/\s]+$/.test(endpoint) || /^http:\/\/localhost(:\d+)?$/.test(endpoint);
  if (!secure || !token || !SPACE_PATTERN.test(space)) {
    return null;
  }
  return { provider: "d1", endpoint, token, space };
}

function objectUrl(source: D1Source, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${source.endpoint}/v1/spaces/${encodeURIComponent(source.space)}/objects/${encodedPath}`;
}

/**
 * 接続テストで案内を分けるための理由。一覧の操作中のエラーは `kind` だけを使う。
 * - unreachable: Worker に届かない（URL の誤り・未デプロイ）
 * - wrong_worker: 届いたが d1-worker ではない
 * - r2_worker: 削除した R2 用 Worker の URL
 * - server: d1-worker だが D1 の読み書きで失敗した（migration をしていないなど）
 */
export type D1TestFailure = StorageErrorKind | "unreachable" | "wrong_worker" | "r2_worker" | "server";

class D1AccessError extends StorageAccessError {
  constructor(
    kind: StorageErrorKind,
    readonly reason: D1TestFailure
  ) {
    super(kind);
  }
}

async function workerFetch(source: D1Source, url: string, init: FetchOptions = {}): Promise<FetchResponse> {
  try {
    return await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${source.token}` } });
  } catch {
    throw new D1AccessError("network", "unreachable");
  }
}

/** Worker の本文は UI に出さず、種類だけにする。 */
function toError(response: FetchResponse): StorageAccessError {
  if (response.status === 401 || response.status === 403) {
    return new D1AccessError("auth", "auth");
  }
  if (response.status === 400) {
    return new D1AccessError("folder", "folder");
  }
  return new D1AccessError("network", response.status >= 500 ? "server" : "network");
}

/** URL の先が d1-worker で、トークンが通るか。 */
async function ping(source: D1Source): Promise<void> {
  const response = await workerFetch(source, `${source.endpoint}/v1/ping`);
  if (response.status === 401 || response.status === 403) {
    throw new D1AccessError("auth", "auth");
  }
  // ping は D1 を使わないので、ほかの失敗（404・5xx など）は Worker 自体に届いていないものとして扱う。
  if (!response.ok) {
    throw new D1AccessError("network", "unreachable");
  }
  const body = (await response.json().catch(() => null)) as { app?: unknown } | null;
  if (body?.app === R2_PING_APP) {
    throw new D1AccessError("network", "r2_worker");
  }
  if (body?.app !== PING_APP) {
    throw new D1AccessError("network", "wrong_worker");
  }
}

async function readText(source: D1Source, path: string): Promise<string | undefined> {
  const response = await workerFetch(source, objectUrl(source, path));
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw toError(response);
  }
  return response.text();
}

async function writeText(source: D1Source, path: string, text: string): Promise<void> {
  const response = await workerFetch(source, objectUrl(source, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  if (!response.ok) {
    throw toError(response);
  }
}

async function deleteObject(source: D1Source, path: string): Promise<void> {
  const response = await workerFetch(source, objectUrl(source, path), { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw toError(response);
  }
}

export class D1StorageAdapter implements StorageAdapter {
  readonly type = "d1" as const;
  readonly quotaBytes = null;

  private readonly values = new Map<string, { text: string; at: number }>();
  private ready: Promise<void> | null = null;

  constructor(readonly source: D1Source) {}

  /** Worker に届き、スペースに印（metadata.json）があるか確かめる。無ければ作る。 */
  verify(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await ping(this.source);
        const text = await readText(this.source, METADATA_FILE);
        if (text === undefined) {
          await writeText(this.source, METADATA_FILE, encodeValue(newMetadata()));
        } else if (!isMetadata(safeDecode(text))) {
          throw new StorageAccessError("folder");
        }
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async get(key: string): Promise<unknown> {
    const cached = this.values.get(key);
    if (cached && Date.now() - cached.at < VALUE_CACHE_MS) {
      return decodeValue(cached.text);
    }
    await this.verify();
    const path = locatePath(key);
    const text = await readText(this.source, path);
    if (text === undefined) {
      this.values.delete(key);
      return undefined;
    }
    this.remember(key, path, text);
    return safeDecode(text);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.verify();
    const path = locatePath(key);
    const text = encodeValue(value);
    await writeText(this.source, path, text);
    this.remember(key, path, text);
  }

  async remove(key: string): Promise<void> {
    await this.verify();
    this.values.delete(key);
    await deleteObject(this.source, locatePath(key));
  }

  private remember(key: string, path: string, text: string): void {
    if (path.includes("/")) {
      return;
    }
    this.values.set(key, { text, at: Date.now() });
  }
}

function safeDecode(text: string): unknown {
  try {
    return decodeValue(text);
  } catch {
    return undefined;
  }
}

/**
 * Worker に届くか → d1-worker か → 合言葉が通るか → スペースに書けて読めるか、の順に確かめる。
 * テスト用のファイルは作ってすぐ消す。成功なら null、失敗なら理由。
 */
export async function testD1Connection(source: D1Source): Promise<D1TestFailure | null> {
  try {
    await ping(source);
    const content = encodeValue({ test: true, at: new Date().toISOString() });
    await writeText(source, TEST_FILE, content);
    try {
      if ((await readText(source, TEST_FILE)) !== content) {
        throw new StorageAccessError("folder");
      }
    } finally {
      await deleteObject(source, TEST_FILE).catch(() => undefined);
    }
    return null;
  } catch (err) {
    if (err instanceof D1AccessError) {
      return err.reason;
    }
    return err instanceof StorageAccessError ? err.kind : "network";
  }
}
