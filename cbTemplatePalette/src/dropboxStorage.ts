import type { DropboxTokens } from "./dropboxAuth";
import { METADATA_FILE, TEST_FILE, decodeValue, encodeValue, isMetadata, locatePath, newMetadata } from "./jsonCodec";
import { StorageAccessError, type StorageAdapter } from "./storageAdapter";
import type { DropboxFolder, DropboxSource, StorageErrorKind } from "./types";

/**
 * Dropbox のフォルダを保存先にする。キーごとの JSON を置く（ファイル構成は jsonCodec.ts）。
 * API の本文は UI に出さず、エラーは種類だけにする。
 */

const API_URL = "https://api.dropboxapi.com/2";
const CONTENT_URL = "https://content.dropboxapi.com/2";
/** 1 回の操作の中で何度も読む index や tree を、取りに行かずに返す時間。 */
const VALUE_CACHE_MS = 5000;
/** 書き込みが混んでいると 429 が返る。待ってやり直す回数。 */
const MAX_RATE_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10 * 1000;
/** フォルダ一覧を何ページまで読むか（大きすぎる Dropbox で止まらないように）。 */
const MAX_LIST_PAGES = 10;

/** 保存先として使える形に整える。使えない値なら null。 */
export function normalizeDropboxSource(value: unknown): DropboxSource | null {
  const source = value as Partial<DropboxSource> | null;
  if (!source || typeof source !== "object" || source.provider !== "dropbox") {
    return null;
  }
  const path = typeof source.path === "string" ? source.path.trim().replace(/\/+$/, "") : "";
  if (!path.startsWith("/") || path.length < 2) {
    return null;
  }
  const label = typeof source.label === "string" && source.label.trim() ? source.label.trim() : path.slice(path.lastIndexOf("/") + 1);
  const namespaceId =
    typeof source.namespaceId === "string" && /^\d+$/.test(source.namespaceId) ? source.namespaceId : undefined;
  return { provider: "dropbox", path, label, ...(namespaceId ? { namespaceId } : {}) };
}

/** 保存先フォルダそのもののパス。共有フォルダの根は名前空間で指す。 */
function folderPath(source: DropboxSource): string {
  return source.namespaceId ? `ns:${source.namespaceId}` : source.path;
}

function filePath(source: DropboxSource, relative: string): string {
  return `${folderPath(source)}/${relative}`;
}

/** `Dropbox-API-Arg` ヘッダーは ASCII しか通らないので、日本語のフォルダ名などは \uXXXX にする。 */
function headerArg(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: FetchResponse): number {
  const seconds = Number(response.headersObject?.["retry-after"] ?? response.headersObject?.["Retry-After"]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : 1000;
}

/**
 * トークンを付けて呼ぶ。401 は 1 回だけトークンを取り直して、429 は待って、やり直す。
 * 未接続なら auth。
 */
async function send(
  tokens: DropboxTokens | null,
  url: string,
  init: { headers?: Record<string, string>; body?: string }
): Promise<FetchResponse> {
  if (!tokens) {
    throw new StorageAccessError("auth");
  }
  let refreshed = false;
  let rateRetries = 0;
  for (;;) {
    const token = await tokens.accessToken();
    let response: FetchResponse;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    } catch {
      throw new StorageAccessError("network");
    }
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      tokens.invalidate();
      continue;
    }
    if (response.status === 429 && rateRetries < MAX_RATE_RETRIES) {
      rateRetries += 1;
      await sleep(retryAfterMs(response));
      continue;
    }
    return response;
  }
}

function rpc(tokens: DropboxTokens | null, endpoint: string, args: unknown): Promise<FetchResponse> {
  return send(tokens, `${API_URL}/${endpoint}`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

/** 409 の本文（`error_summary` が `path/not_found/..` など）から、見つからないだけかを見る。 */
async function isNotFound(response: FetchResponse): Promise<boolean> {
  if (response.status !== 409) {
    return false;
  }
  const body = (await response.json().catch(() => null)) as { error_summary?: unknown } | null;
  return typeof body?.error_summary === "string" && body.error_summary.includes("not_found");
}

function toError(response: FetchResponse): StorageAccessError {
  if (response.status === 401 || response.status === 403) {
    return new StorageAccessError("auth");
  }
  if (response.status === 400 || response.status === 409) {
    return new StorageAccessError("folder");
  }
  return new StorageAccessError("network");
}

async function readText(tokens: DropboxTokens | null, path: string): Promise<string | undefined> {
  const response = await send(tokens, `${CONTENT_URL}/files/download`, {
    headers: { "Dropbox-API-Arg": headerArg({ path }) },
  });
  if (await isNotFound(response)) {
    return undefined;
  }
  if (!response.ok) {
    throw toError(response);
  }
  return response.text();
}

/** 本文は encodeValue が ASCII だけにしてあるので、そのまま送れる。 */
async function writeText(tokens: DropboxTokens | null, path: string, text: string): Promise<void> {
  const response = await send(tokens, `${CONTENT_URL}/files/upload`, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": headerArg({ path, mode: "overwrite", autorename: false, mute: true }),
    },
    body: text,
  });
  if (!response.ok) {
    throw toError(response);
  }
}

async function deleteFile(tokens: DropboxTokens | null, path: string): Promise<void> {
  const response = await rpc(tokens, "files/delete_v2", { path });
  if (!response.ok && !(await isNotFound(response))) {
    throw toError(response);
  }
}

/** 保存先フォルダがあるか。無い・ファイルだったら folder（黙って作り直さない）。 */
async function ensureFolder(tokens: DropboxTokens | null, source: DropboxSource): Promise<void> {
  const response = await rpc(tokens, "files/get_metadata", { path: folderPath(source) });
  if (!response.ok) {
    throw toError(response);
  }
  const body = (await response.json().catch(() => null)) as { ".tag"?: unknown } | null;
  if (body?.[".tag"] !== "folder") {
    throw new StorageAccessError("folder");
  }
}

export class DropboxStorageAdapter implements StorageAdapter {
  readonly type = "dropbox" as const;
  readonly quotaBytes = null;

  private readonly values = new Map<string, { text: string; at: number }>();
  private ready: Promise<void> | null = null;

  constructor(
    readonly source: DropboxSource,
    private readonly tokens: DropboxTokens | null
  ) {}

  /** フォルダがあり、印（metadata.json）があるか確かめる。印が無ければ作る。 */
  verify(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await ensureFolder(this.tokens, this.source);
        const path = filePath(this.source, METADATA_FILE);
        const text = await readText(this.tokens, path);
        if (text === undefined) {
          await writeText(this.tokens, path, encodeValue(newMetadata()));
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
    const relative = locatePath(key);
    const text = await readText(this.tokens, filePath(this.source, relative));
    if (text === undefined) {
      this.values.delete(key);
      return undefined;
    }
    this.remember(key, relative, text);
    return safeDecode(text);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.verify();
    const relative = locatePath(key);
    const text = encodeValue(value);
    await writeText(this.tokens, filePath(this.source, relative), text);
    this.remember(key, relative, text);
  }

  async remove(key: string): Promise<void> {
    await this.verify();
    this.values.delete(key);
    await deleteFile(this.tokens, filePath(this.source, locatePath(key)));
  }

  private remember(key: string, relative: string, text: string): void {
    if (relative.includes("/")) {
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
 * フォルダがあるか → 書けて読めるか、の順に確かめる。テスト用のファイルは作ってすぐ消す。
 * 成功なら null、失敗ならエラーの種類。
 */
export async function testDropboxConnection(
  tokens: DropboxTokens | null,
  source: DropboxSource
): Promise<StorageErrorKind | null> {
  try {
    await ensureFolder(tokens, source);
    const path = filePath(source, TEST_FILE);
    const content = encodeValue({ test: true, at: new Date().toISOString() });
    await writeText(tokens, path, content);
    try {
      if ((await readText(tokens, path)) !== content) {
        throw new StorageAccessError("folder");
      }
    } finally {
      await deleteFile(tokens, path).catch(() => undefined);
    }
    return null;
  } catch (err) {
    return err instanceof StorageAccessError ? err.kind : "network";
  }
}

interface ListedEntry {
  ".tag"?: string;
  name?: string;
  path_display?: string;
  sharing_info?: { shared_folder_id?: string };
}

interface ListResult {
  entries?: ListedEntry[];
  cursor?: string;
  has_more?: boolean;
}

/** `path` の中のフォルダ（`""` は一番上）。名前の順。 */
export async function listDropboxFolders(tokens: DropboxTokens | null, path: string): Promise<DropboxFolder[]> {
  const folders: DropboxFolder[] = [];
  let response = await rpc(tokens, "files/list_folder", { path, include_mounted_folders: true, limit: 1000 });
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    if (!response.ok) {
      throw toError(response);
    }
    const body = ((await response.json().catch(() => null)) ?? {}) as ListResult;
    for (const entry of body.entries ?? []) {
      if (entry[".tag"] === "folder" && typeof entry.name === "string" && typeof entry.path_display === "string") {
        const namespaceId = entry.sharing_info?.shared_folder_id;
        folders.push({
          name: entry.name,
          path: entry.path_display,
          ...(typeof namespaceId === "string" && /^\d+$/.test(namespaceId) ? { namespaceId } : {}),
        });
      }
    }
    if (!body.has_more || !body.cursor) {
      break;
    }
    response = await rpc(tokens, "files/list_folder/continue", { cursor: body.cursor });
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** フォルダを作る。同じ名前があれば folder。 */
export async function createDropboxFolder(tokens: DropboxTokens | null, path: string): Promise<void> {
  const response = await rpc(tokens, "files/create_folder_v2", { path, autorename: false });
  if (!response.ok) {
    throw toError(response);
  }
}
