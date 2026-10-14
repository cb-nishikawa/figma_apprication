/**
 * テンプレパレットくんの共有カテゴリを Cloudflare D1 に置くための Worker。
 *
 * - 各自・チームが自分の Cloudflare にデプロイする。D1 にはバインディングで触るので、Cloudflare の API トークンはどこにも出てこない
 * - プラグインは一括 API（`POST /v1/spaces/<space>/batch`、本文にトークン）で呼ぶ。合言葉が合わなければ何もしない
 *   - POST・text/plain・独自ヘッダー無しなので、CORS の preflight（OPTIONS）が起きない
 *   - 古い版のプラグインのために、`Authorization: Bearer` で呼ぶ 1 件ずつの API も残す
 * - プラグインの画面は null origin なので CORS は `*`
 * - 1 つのファイルは `objects` テーブルの (space, path) の行。同じ space を指定した人どうしで同じデータになる
 * - D1 の 1 行は約 2MB までなので、本文は UTF-8 で 1MB ごとの chunk に分けて持つ
 */

interface Env {
  DB: D1Database;
  ACCESS_TOKEN: string;
}

const APP = "cbTemplatePalette-d1";
const SPACE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._%-]{1,200}$/;
const MAX_DEPTH = 4;
/** テンプレート 1 件（画像込み）の上限。chunk の数（= 1 回の batch の文の数）もこれで抑える。 */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 1000 * 1000;
/** 一括 API の版。古い Worker（401 で api が無い）と見分けるために返す。 */
const API_VERSION = 2;
const MAX_BATCH_BYTES = 30 * 1024 * 1024;
/** 無料プランは 1 回の呼び出しで 50 クエリまで。読み込みの 1 文も含めて数える。 */
const MAX_STATEMENTS = 45;
/** D1 の 1 文の引数は 100 まで（space の分を除く）。 */
const MAX_PATHS_PER_STATEMENT = 90;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    try {
      const url = new URL(request.url);
      const batchMatch = /^\/v1\/spaces\/([^/]+)\/batch$/.exec(url.pathname);
      if (batchMatch && request.method === "POST") {
        return await handleBatch(request, env, batchMatch[1]);
      }
      if (!(await authorized(request, env))) {
        return json({ error: "auth" }, 401);
      }
      if (url.pathname === "/v1/ping" && request.method === "GET") {
        return json({ ok: true, app: APP });
      }
      const match = /^\/v1\/spaces\/([^/]+)\/objects\/(.+)$/.exec(url.pathname);
      if (!match) {
        return json({ error: "not_found" }, 404);
      }
      const target = objectTarget(match[1], match[2]);
      if (!target) {
        return json({ error: "invalid" }, 400);
      }
      switch (request.method) {
        case "GET":
          return await getObject(env, target);
        case "PUT":
          return await putObject(request, env, target);
        case "DELETE":
          await env.DB.prepare("DELETE FROM objects WHERE space = ?1 AND path = ?2")
            .bind(target.space, target.path)
            .run();
          return json({ ok: true });
        default:
          return json({ error: "method" }, 405);
      }
    } catch {
      return json({ error: "server" }, 500);
    }
  },
};

async function authorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  return tokenAllowed(header.startsWith("Bearer ") ? header.slice(7).trim() : "", env);
}

/** 合言葉の比較。長さや一致位置が時間に出ないよう、ハッシュにしてから比べる。 */
async function tokenAllowed(given: string, env: Env): Promise<boolean> {
  const allowed = (env.ACCESS_TOKEN ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (!given || allowed.length === 0) {
    return false;
  }
  const givenHash = await sha256(given);
  let ok = false;
  for (const token of allowed) {
    if (crypto.subtle.timingSafeEqual(givenHash, await sha256(token))) {
      ok = true;
    }
  }
  return ok;
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

interface Target {
  space: string;
  path: string;
}

/** URL の space と path を確かめる。使えない文字や `..` があれば null。 */
function objectTarget(rawSpace: string, rawPath: string): Target | null {
  let space: string;
  let segments: string[];
  try {
    space = decodeURIComponent(rawSpace);
    segments = rawPath.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (!SPACE_PATTERN.test(space) || segments.length > MAX_DEPTH) {
    return null;
  }
  if (segments.some((segment) => !SEGMENT_PATTERN.test(segment) || segment === "." || segment === "..")) {
    return null;
  }
  return { space, path: segments.join("/") };
}

async function getObject(env: Env, target: Target): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT body FROM objects WHERE space = ?1 AND path = ?2 ORDER BY chunk"
  )
    .bind(target.space, target.path)
    .all<{ body: string }>();
  if (results.length === 0) {
    return json({ error: "not_found" }, 404);
  }
  return new Response(results.map((row) => row.body).join(""), {
    headers: { ...corsHeaders(), "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function putObject(request: Request, env: Env, target: Target): Promise<Response> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  let chunks: string[];
  try {
    chunks = splitUtf8(bytes, CHUNK_BYTES);
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const now = Date.now();
  // 同じ chunk は上書きにする（消して入れ直すと、行と索引の書き込みが増えるため）。余った chunk だけ消す。
  const statements = [
    ...chunks.map((body, chunk) =>
      env.DB.prepare(
        "INSERT INTO objects (space, path, chunk, body, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
          "ON CONFLICT (space, path, chunk) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
      ).bind(target.space, target.path, chunk, body, now)
    ),
    env.DB.prepare("DELETE FROM objects WHERE space = ?1 AND path = ?2 AND chunk >= ?3").bind(
      target.space,
      target.path,
      chunks.length
    ),
  ];
  // batch は 1 つのトランザクション。途中で失敗しても古い本文が残る。
  await env.DB.batch(statements);
  return json({ ok: true });
}

/** UTF-8 の文字の途中で切らないように、`size` バイト以下ずつの文字列にする。空の本文も 1 つの chunk にする。 */
function splitUtf8(bytes: Uint8Array, size: number): string[] {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const chunks: string[] = [];
  let start = 0;
  do {
    let end = Math.min(start + size, bytes.length);
    // 続きのバイト（10xxxxxx）の手前まで戻る。
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  } while (start < bytes.length);
  return chunks;
}

/* ------------------------------ 一括 API ------------------------------ */

interface BatchRequest {
  token: string;
  get: string[];
  put: Array<{ path: string; body: string }>;
  delete: string[];
}

function batchJson(body: Record<string, unknown>, status = 200): Response {
  return json({ ...body, api: API_VERSION }, status);
}

function validPath(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const segments = raw.split("/");
  if (segments.length > MAX_DEPTH) {
    return null;
  }
  if (segments.some((segment) => !SEGMENT_PATTERN.test(segment) || segment === "." || segment === "..")) {
    return null;
  }
  return raw;
}

function parseBatch(value: unknown): BatchRequest | null {
  const body = value as Partial<Record<keyof BatchRequest, unknown>> | null;
  if (!body || typeof body !== "object" || typeof body.token !== "string") {
    return null;
  }
  const list = (raw: unknown) => (raw === undefined ? [] : Array.isArray(raw) ? raw : null);
  const get = list(body.get);
  const put = list(body.put);
  const del = list(body.delete);
  if (!get || !put || !del) {
    return null;
  }
  return {
    token: body.token.trim(),
    get: get as string[],
    put: put as Array<{ path: string; body: string }>,
    delete: del as string[],
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

function placeholders(count: number, from: number): string {
  return Array.from({ length: count }, (_, i) => `?${from + i}`).join(", ");
}

/**
 * `{ token, get?, put?, delete? }` を 1 回で処理する。書き込み（削除 → 上書き）は 1 つのトランザクション、
 * 読み込みはその後に 1 文。何も無ければ ping として `app` だけを返す。
 */
async function handleBatch(request: Request, env: Env, rawSpace: string): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BATCH_BYTES) {
    return batchJson({ error: "too_large" }, 413);
  }
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BATCH_BYTES) {
    return batchJson({ error: "too_large" }, 413);
  }
  let parsed: BatchRequest | null;
  try {
    parsed = parseBatch(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return batchJson({ error: "invalid" }, 400);
  }
  if (!(await tokenAllowed(parsed.token, env))) {
    return batchJson({ error: "auth" }, 401);
  }
  let space: string;
  try {
    space = decodeURIComponent(rawSpace);
  } catch {
    return batchJson({ error: "invalid" }, 400);
  }
  const gets = parsed.get.map(validPath);
  const dels = parsed.delete.map(validPath);
  const puts = parsed.put.map((entry) => ({
    path: validPath(entry?.path),
    body: typeof entry?.body === "string" ? entry.body : null,
  }));
  if (
    !SPACE_PATTERN.test(space) ||
    gets.some((path) => !path) ||
    dels.some((path) => !path) ||
    puts.some((entry) => !entry.path || entry.body === null) ||
    gets.length > MAX_PATHS_PER_STATEMENT
  ) {
    return batchJson({ error: "invalid" }, 400);
  }

  const encoder = new TextEncoder();
  const statements: D1PreparedStatement[] = [];
  for (const group of chunked(dels as string[], MAX_PATHS_PER_STATEMENT)) {
    statements.push(
      env.DB.prepare(`DELETE FROM objects WHERE space = ?1 AND path IN (${placeholders(group.length, 2)})`).bind(
        space,
        ...group
      )
    );
  }
  const now = Date.now();
  for (const entry of puts as Array<{ path: string; body: string }>) {
    const bytes = encoder.encode(entry.body);
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return batchJson({ error: "too_large" }, 413);
    }
    const chunks = splitUtf8(bytes, CHUNK_BYTES);
    for (const [chunk, body] of chunks.entries()) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO objects (space, path, chunk, body, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
            "ON CONFLICT (space, path, chunk) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
        ).bind(space, entry.path, chunk, body, now)
      );
    }
    statements.push(
      env.DB.prepare("DELETE FROM objects WHERE space = ?1 AND path = ?2 AND chunk >= ?3").bind(
        space,
        entry.path,
        chunks.length
      )
    );
  }
  if (statements.length + (gets.length > 0 ? 1 : 0) > MAX_STATEMENTS) {
    return batchJson({ error: "too_many" }, 413);
  }
  if (statements.length > 0) {
    // batch は 1 つのトランザクション。途中で失敗しても古い本文が残る。
    await env.DB.batch(statements);
  }

  const objects: Record<string, string | null> = {};
  if (gets.length > 0) {
    const paths = [...new Set(gets as string[])];
    const { results } = await env.DB.prepare(
      `SELECT path, body FROM objects WHERE space = ?1 AND path IN (${placeholders(paths.length, 2)}) ORDER BY path, chunk`
    )
      .bind(space, ...paths)
      .all<{ path: string; body: string }>();
    for (const path of paths) {
      objects[path] = null;
    }
    for (const row of results) {
      objects[row.path] = (objects[row.path] ?? "") + row.body;
    }
  }
  return batchJson({ ok: true, app: APP, objects });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json", "cache-control": "no-store" },
  });
}
