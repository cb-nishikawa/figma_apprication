import { METADATA_FILE, TEST_FILE, decodeValue, encodeValue, isMetadata, locatePath, newMetadata } from "./jsonCodec";
import { StorageAccessError, type StorageAdapter } from "./storageAdapter";
import type { R2Source, StorageErrorKind } from "./types";

/**
 * Cloudflare R2 の保存先。ユーザー（チーム）が自分で立てた Worker（cbTemplatePalette/r2-worker）に
 * キーごとの JSON を置く。ファイル構成は jsonCodec.ts。
 * R2 の Access Key はプラグインに置かず、Worker の合言葉（token）だけを送る。
 */

const PING_APP = "cbTemplatePalette-r2";
const SPACE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
/** 1 回の操作の中で何度も読む index や tree を、取りに行かずに返す時間。 */
const VALUE_CACHE_MS = 5000;

/** 入力された R2 の設定を整える。使えない値なら null。 */
export function normalizeR2Source(value: unknown): R2Source | null {
  const source = value as Partial<R2Source> | null;
  if (!source || typeof source !== "object") {
    return null;
  }
  const endpoint = typeof source.endpoint === "string" ? source.endpoint.trim().replace(/\/+$/, "") : "";
  const token = typeof source.token === "string" ? source.token.trim() : "";
  const space = typeof source.space === "string" && source.space.trim() ? source.space.trim() : "default";
  const secure = /^https:\/\/[^/\s]+$/.test(endpoint) || /^http:\/\/localhost(:\d+)?$/.test(endpoint);
  if (!secure || !token || !SPACE_PATTERN.test(space)) {
    return null;
  }
  return { provider: "r2", endpoint, token, space };
}

function objectUrl(source: R2Source, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${source.endpoint}/v1/spaces/${encodeURIComponent(source.space)}/objects/${encodedPath}`;
}

async function r2Fetch(source: R2Source, url: string, init: FetchOptions = {}): Promise<FetchResponse> {
  try {
    return await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${source.token}` } });
  } catch {
    throw new StorageAccessError("network");
  }
}

/** Worker の本文は UI に出さず、種類だけにする。 */
function toError(response: FetchResponse): StorageAccessError {
  if (response.status === 401 || response.status === 403) {
    return new StorageAccessError("auth");
  }
  if (response.status === 400) {
    return new StorageAccessError("folder");
  }
  return new StorageAccessError("network");
}

/** URL の先が r2-worker で、トークンが通るか。 */
async function ping(source: R2Source): Promise<void> {
  const response = await r2Fetch(source, `${source.endpoint}/v1/ping`);
  if (!response.ok) {
    throw toError(response);
  }
  const body = (await response.json().catch(() => null)) as { app?: string } | null;
  if (body?.app !== PING_APP) {
    throw new StorageAccessError("network");
  }
}

async function readText(source: R2Source, path: string): Promise<string | undefined> {
  const response = await r2Fetch(source, objectUrl(source, path));
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw toError(response);
  }
  return response.text();
}

async function writeText(source: R2Source, path: string, text: string): Promise<void> {
  const response = await r2Fetch(source, objectUrl(source, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  if (!response.ok) {
    throw toError(response);
  }
}

async function deleteObject(source: R2Source, path: string): Promise<void> {
  const response = await r2Fetch(source, objectUrl(source, path), { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw toError(response);
  }
}

export class R2StorageAdapter implements StorageAdapter {
  readonly type = "r2" as const;
  readonly quotaBytes = null;

  private readonly values = new Map<string, { text: string; at: number }>();
  private ready: Promise<void> | null = null;

  constructor(readonly source: R2Source) {}

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
 * Worker に届くか → 合言葉が通るか → スペースに書けて読めるか、の順に確かめる。
 * テスト用のオブジェクトは作ってすぐ消す。成功なら null、失敗ならエラーの種類。
 */
export async function testR2Connection(source: R2Source): Promise<StorageErrorKind | null> {
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
    return err instanceof StorageAccessError ? err.kind : "network";
  }
}
