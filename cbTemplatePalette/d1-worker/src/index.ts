/**
 * テンプレパレットくんの共有カテゴリを Cloudflare D1 に置くための Worker。
 *
 * - 各自・チームが自分の Cloudflare にデプロイする。D1 にはバインディングで触るので、Cloudflare の API トークンはどこにも出てこない
 * - プラグインは `Authorization: Bearer <ACCESS_TOKEN>` を付けて呼ぶ。合言葉が合わなければ何もしない
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    try {
      if (!(await authorized(request, env))) {
        return json({ error: "auth" }, 401);
      }
      const url = new URL(request.url);
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

/** 合言葉の比較。長さや一致位置が時間に出ないよう、ハッシュにしてから比べる。 */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
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
  const statements = [
    env.DB.prepare("DELETE FROM objects WHERE space = ?1 AND path = ?2").bind(target.space, target.path),
    ...chunks.map((body, chunk) =>
      env.DB.prepare("INSERT INTO objects (space, path, chunk, body, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
        target.space,
        target.path,
        chunk,
        body,
        now
      )
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

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
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
