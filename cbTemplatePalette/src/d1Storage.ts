import { METADATA_FILE, METADATA_KEY, TEST_FILE, decodeValue, encodeValue, isMetadata, locatePath, newMetadata } from "./jsonCodec";
import { SHARED_QUOTA_BYTES, StorageAccessError, type StorageAdapter } from "./storageAdapter";
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
/** index や tree を取りに行かずに返す時間。ほかの人の変更は、見えるまでこれだけ遅れることがある。 */
const VALUE_CACHE_MS = 10_000;

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

/** 一括 API の版。Worker がこれを返さなければ古い Worker。 */
const API_VERSION = 2;
/** まとめて読む一番上のキー。開いたときの確認では metadata も一緒に読む。 */
const TOP_KEYS = ["cbTemplatePalette.index", "cbTemplatePalette.tree", "cbTemplatePalette.categories"];
const PREFETCH_KEYS = [METADATA_KEY, ...TOP_KEYS];

/**
 * 接続テストで案内を分けるための理由。一覧の操作中のエラーは `kind` だけを使う。
 * - unreachable: Worker に届かない（URL の誤り・未デプロイ）
 * - wrong_worker: 届いたが d1-worker ではない
 * - r2_worker: 削除した R2 用 Worker の URL
 * - old_worker: 一括 API を持たない、更新前の d1-worker
 * - server: d1-worker だが D1 の読み書きで失敗した（migration をしていないなど）
 */
export type D1TestFailure =
  | StorageErrorKind
  | "unreachable"
  | "wrong_worker"
  | "r2_worker"
  | "old_worker"
  | "server";

class D1AccessError extends StorageAccessError {
  constructor(
    kind: StorageErrorKind,
    readonly reason: D1TestFailure
  ) {
    super(kind);
  }
}

interface BatchOps {
  get?: string[];
  put?: Array<{ path: string; body: string }>;
  delete?: string[];
  /** スペースのファイルを全部消す。 */
  clear?: boolean;
}

/**
 * Worker の一括 API を 1 回呼ぶ。POST・text/plain・独自ヘッダー無しにして CORS の preflight を起こさないため、
 * トークンはヘッダーではなく本文に入れる（URL には入れない）。返すのは読んだファイル（無ければ null）。
 * Worker の本文は UI に出さず、種類だけにする。
 */
async function batch(source: D1Source, ops: BatchOps): Promise<Record<string, string | null>> {
  let response: FetchResponse;
  try {
    response = await fetch(`${source.endpoint}/v1/spaces/${encodeURIComponent(source.space)}/batch`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ token: source.token, ...ops }),
    });
  } catch {
    throw new D1AccessError("network", "unreachable");
  }
  const body = (await response.json().catch(() => null)) as {
    app?: unknown;
    api?: unknown;
    objects?: Record<string, string | null>;
    cleared?: unknown;
  } | null;
  const current = body?.api === API_VERSION;
  if (response.status === 401 || response.status === 403) {
    throw new D1AccessError("auth", current ? "auth" : "old_worker");
  }
  if (!response.ok) {
    if (response.status === 400) {
      throw new D1AccessError("folder", "folder");
    }
    throw new D1AccessError("network", response.status >= 500 ? "server" : current ? "network" : "unreachable");
  }
  if (body?.app === R2_PING_APP) {
    throw new D1AccessError("network", "r2_worker");
  }
  if (body?.app !== PING_APP || !current) {
    throw new D1AccessError("network", "wrong_worker");
  }
  // clear を知らない Worker は clear を無視して ok を返すので、消えていない。
  if (ops.clear && body.cleared !== true) {
    throw new D1AccessError("network", "old_worker");
  }
  return body.objects ?? {};
}

/**
 * 保存先ごとの確認結果と読み込み結果。設定の切り替えなどで D1StorageAdapter を作り直しても、
 * 同じ保存先なら確認（ping と metadata.json）をやり直さない。
 */
interface SourceState {
  ready: Promise<void> | null;
  /** `text: null` はファイルが無いと分かっているもの。 */
  values: Map<string, { text: string | null; at: number }>;
}

const sourceStates = new Map<string, SourceState>();

function stateFor(source: D1Source): SourceState {
  const key = `${source.endpoint}\n${source.space}\n${source.token}`;
  let state = sourceStates.get(key);
  if (!state) {
    state = { ready: null, values: new Map() };
    sourceStates.set(key, state);
  }
  return state;
}

export class D1StorageAdapter implements StorageAdapter {
  readonly type = "d1" as const;
  readonly quotaBytes = SHARED_QUOTA_BYTES;

  private readonly state: SourceState;

  constructor(readonly source: D1Source) {
    this.state = stateFor(source);
  }

  /**
   * Worker に届き、スペースに印（metadata.json）があるか確かめる。無ければ作る。
   * 同じ 1 回で index・tree・categories も読んで覚えておく（開いた直後の読み込みに使う）。
   */
  verify(): Promise<void> {
    const state = this.state;
    if (!state.ready) {
      state.ready = (async () => {
        const objects = await batch(this.source, { get: PREFETCH_KEYS.map(locatePath) });
        const metadata = objects[METADATA_FILE] ?? null;
        if (metadata !== null && !isMetadata(safeDecode(metadata))) {
          throw new StorageAccessError("folder");
        }
        for (const key of TOP_KEYS) {
          this.remember(key, objects[locatePath(key)] ?? null);
        }
        if (metadata === null) {
          await this.write([{ key: METADATA_KEY, value: newMetadata() }]);
        } else {
          this.remember(METADATA_KEY, metadata);
        }
      })().catch((err) => {
        state.ready = null;
        throw err;
      });
    }
    return state.ready;
  }

  forget(): void {
    this.state.values.clear();
  }

  async get(key: string): Promise<unknown> {
    let cached = this.cached(key);
    if (cached === undefined) {
      await this.verify();
      cached = this.cached(key);
    }
    if (cached !== undefined) {
      return cached === null ? undefined : safeDecode(cached);
    }
    // 一番上のキーは、続けて読まれることが多いので 3 つまとめて読む。
    const keys = TOP_KEYS.includes(key) ? TOP_KEYS : [key];
    const objects = await batch(this.source, { get: keys.map(locatePath) });
    for (const entry of keys) {
      this.remember(entry, objects[locatePath(entry)] ?? null);
    }
    const text = objects[locatePath(key)] ?? null;
    return text === null ? undefined : safeDecode(text);
  }

  set(key: string, value: unknown): Promise<void> {
    return this.setMany([{ key, value }]);
  }

  remove(key: string): Promise<void> {
    return this.setMany([{ key }]);
  }

  /** まとめて 1 回で書く（D1 では 1 つのトランザクション）。`value` が無いものは消す。 */
  async setMany(entries: Array<{ key: string; value?: unknown }>): Promise<void> {
    await this.verify();
    await this.write(entries);
  }

  private async write(entries: Array<{ key: string; value?: unknown }>): Promise<void> {
    const put: Array<{ path: string; body: string }> = [];
    const del: string[] = [];
    const texts = new Map<string, string | null>();
    for (const { key, value } of entries) {
      const path = locatePath(key);
      if (value === undefined) {
        del.push(path);
        texts.set(key, null);
      } else {
        const body = encodeValue(value);
        put.push({ path, body });
        texts.set(key, body);
      }
    }
    if (put.length === 0 && del.length === 0) {
      return;
    }
    try {
      await batch(this.source, { put, delete: del });
    } catch (err) {
      for (const key of texts.keys()) {
        this.state.values.delete(key);
      }
      throw err;
    }
    for (const [key, text] of texts) {
      this.remember(key, text);
    }
  }

  /** 使い回せる値。無ければ undefined、ファイルが無いと分かっていれば null。 */
  private cached(key: string): string | null | undefined {
    const entry = this.state.values.get(key);
    return entry && Date.now() - entry.at < VALUE_CACHE_MS ? entry.text : undefined;
  }

  /** 一番上のファイル（index・tree など）だけ覚える。item は大きいので覚えない。 */
  private remember(key: string, text: string | null): void {
    if (locatePath(key).includes("/")) {
      return;
    }
    this.state.values.set(key, { text, at: Date.now() });
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
 * スペースのファイルを Worker 側で全部消す（一覧に載っていないものも含む）。成功なら null、失敗なら理由。
 * 消せたら、その保存先の確認結果と読み込み結果も捨てる。
 */
export async function clearD1Space(source: D1Source): Promise<D1TestFailure | null> {
  try {
    await batch(source, { clear: true });
  } catch (err) {
    if (err instanceof D1AccessError) {
      return err.reason;
    }
    return err instanceof StorageAccessError ? err.kind : "network";
  }
  const prefix = `${source.endpoint}\n${source.space}\n`;
  for (const key of [...sourceStates.keys()]) {
    if (key.startsWith(prefix)) {
      sourceStates.delete(key);
    }
  }
  return null;
}

/**
 * Worker に届くか → d1-worker（一括 API を持つ版）か → 合言葉が通るか → スペースに書けて読めるか、の順に確かめる。
 * テスト用のファイルは作ってすぐ消す。成功なら null、失敗なら理由。
 */
export async function testD1Connection(source: D1Source): Promise<D1TestFailure | null> {
  try {
    await batch(source, {});
    const content = encodeValue({ test: true, at: new Date().toISOString() });
    try {
      const objects = await batch(source, { put: [{ path: TEST_FILE, body: content }], get: [TEST_FILE] });
      if (objects[TEST_FILE] !== content) {
        throw new StorageAccessError("folder");
      }
    } finally {
      await batch(source, { delete: [TEST_FILE] }).catch(() => undefined);
    }
    return null;
  } catch (err) {
    if (err instanceof D1AccessError) {
      return err.reason;
    }
    return err instanceof StorageAccessError ? err.kind : "network";
  }
}
