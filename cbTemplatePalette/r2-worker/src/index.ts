/**
 * テンプレパレットくんの保存先を Cloudflare R2 にするための Worker。
 *
 * - 各自・チームが自分の Cloudflare にデプロイする。R2 の Access Key はどこにも出てこない（バインディングで触る）
 * - プラグインは `Authorization: Bearer <ACCESS_TOKEN>` を付けて呼ぶ。合言葉が合わなければ何もしない
 * - プラグインの画面は null origin なので CORS は `*`
 * - オブジェクトのキーは `<space>/<path>`。同じ space を指定した人どうしで同じデータになる
 */

interface Env {
  BUCKET: R2Bucket;
  ACCESS_TOKEN: string;
}

const APP = "cbTemplatePalette-r2";
const SPACE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._%-]{1,200}$/;
const MAX_DEPTH = 4;
/** テンプレート 1 件（画像込み）の上限。 */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

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
      const key = objectKey(match[1], match[2]);
      if (!key) {
        return json({ error: "invalid" }, 400);
      }
      switch (request.method) {
        case "GET":
          return await getObject(env, key);
        case "PUT":
          return await putObject(request, env, key);
        case "DELETE":
          await env.BUCKET.delete(key);
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

/** URL の space と path を R2 のキーにする。使えない文字や `..` があれば null。 */
function objectKey(rawSpace: string, rawPath: string): string | null {
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
  return `${space}/${segments.join("/")}`;
}

async function getObject(env: Env, key: string): Promise<Response> {
  const object = await env.BUCKET.get(key);
  if (!object) {
    return json({ error: "not_found" }, 404);
  }
  return new Response(object.body, {
    headers: { ...corsHeaders(), "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function putObject(request: Request, env: Env, key: string): Promise<Response> {
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true });
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
