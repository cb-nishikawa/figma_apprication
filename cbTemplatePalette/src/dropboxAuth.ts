import type { DropboxSession } from "./dropboxSession";
import { StorageAccessError } from "./storageAdapter";

/**
 * Dropbox への接続（OAuth 2.0 の PKCE。サーバーは置かない）。
 *
 * Figma はリダイレクトを受けられないので、`redirect_uri` を付けずに認可する。Dropbox がブラウザに
 * 表示したコードを UI に貼ってもらい、UI が作った code_verifier と一緒にここで交換する。
 * アクセストークン（4 時間）はメモリにだけ持ち、refresh_token で取り直す。
 */

/**
 * Dropbox App Console で作ったアプリのキー（client_id）。PKCE なので公開してよい値で、App secret は使わない。
 * 空のままだと接続できない。
 */
export const DROPBOX_APP_KEY = "";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API_URL = "https://api.dropboxapi.com/2";
/** App Console で付けるスコープもこの 4 つだけにする。 */
const SCOPES = ["account_info.read", "files.metadata.read", "files.content.read", "files.content.write"];
/** 期限ぎりぎりのトークンで書き込み途中に切れないよう、少し早めに取り直す。 */
const REFRESH_MARGIN_MS = 60 * 1000;
const DEFAULT_EXPIRES_SECONDS = 4 * 60 * 60;

export function isAppKeyConfigured(): boolean {
  return DROPBOX_APP_KEY !== "";
}

/** メインスレッドには URLSearchParams が無いので自前で組み立てる。 */
function form(params: Record<string, string>): string {
  return Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

export function authorizeUrl(challenge: string): string {
  return `${AUTHORIZE_URL}?${form({
    client_id: DROPBOX_APP_KEY,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: SCOPES.join(" "),
  })}`;
}

/** 接続できなかった理由。`code` は貼り付けたコードが違う・期限切れ、`config` はアプリキーが無い。 */
export class DropboxConnectError extends Error {
  constructor(readonly reason: "code" | "network" | "config") {
    super(`dropbox:${reason}`);
  }
}

interface AccessToken {
  value: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  account_id?: string;
}

async function postToken(params: Record<string, string>): Promise<{ status: number; body: TokenResponse | null }> {
  let response: FetchResponse;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form(params),
    });
  } catch {
    return { status: 0, body: null };
  }
  const body = (await response.json().catch(() => null)) as TokenResponse | null;
  return { status: response.status, body };
}

function toAccessToken(body: TokenResponse & { access_token: string }): AccessToken {
  const seconds = typeof body.expires_in === "number" ? body.expires_in : DEFAULT_EXPIRES_SECONDS;
  return { value: body.access_token, expiresAt: Date.now() + seconds * 1000 };
}

/** 引数の無い RPC。Dropbox は本文に `null` を求める。 */
function rpcInit(token: string): FetchOptions {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "null",
  };
}

async function fetchEmail(token: string): Promise<string | undefined> {
  const response = await fetch(`${API_URL}/users/get_current_account`, rpcInit(token));
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json().catch(() => null)) as { email?: unknown } | null;
  return typeof body?.email === "string" ? body.email : undefined;
}

/** 貼り付けたコードを refresh_token とアクセストークンに換える。 */
export async function exchangeCode(code: string, verifier: string): Promise<DropboxTokens> {
  if (!isAppKeyConfigured()) {
    throw new DropboxConnectError("config");
  }
  const { status, body } = await postToken({
    grant_type: "authorization_code",
    code: code.trim(),
    client_id: DROPBOX_APP_KEY,
    code_verifier: verifier,
  });
  if (status === 0 || status === 429 || status >= 500) {
    throw new DropboxConnectError("network");
  }
  if (status !== 200 || !body?.access_token || !body.refresh_token) {
    throw new DropboxConnectError("code");
  }
  const accessToken = toAccessToken({ ...body, access_token: body.access_token });
  const email = await fetchEmail(accessToken.value).catch(() => undefined);
  const session: DropboxSession = {
    refreshToken: body.refresh_token,
    accountId: body.account_id ?? "",
    ...(email ? { email } : {}),
  };
  return new DropboxTokens(session, accessToken);
}

/** Dropbox 側のトークンを取り消す。失敗しても手元の接続は消す（呼び出し側）。 */
export async function revokeTokens(tokens: DropboxTokens): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/token/revoke`, rpcInit(await tokens.accessToken()));
  } catch {
    // 届かなくても、Dropbox の「接続済みアプリ」から取り消せる。
  }
}

/** 1 つの接続のアクセストークン。同時に取り直しが走らないよう 1 本にまとめる。 */
export class DropboxTokens {
  private current: AccessToken | null;
  private pending: Promise<string> | null = null;

  constructor(readonly session: DropboxSession, initial?: AccessToken) {
    this.current = initial ?? null;
  }

  accessToken(): Promise<string> {
    if (this.current && Date.now() < this.current.expiresAt - REFRESH_MARGIN_MS) {
      return Promise.resolve(this.current.value);
    }
    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  /** 401 が返ったとき。次の `accessToken()` で取り直す。 */
  invalidate(): void {
    this.current = null;
  }

  private async refresh(): Promise<string> {
    const { status, body } = await postToken({
      grant_type: "refresh_token",
      refresh_token: this.session.refreshToken,
      client_id: DROPBOX_APP_KEY,
    });
    if (status === 0 || status === 429 || status >= 500) {
      throw new StorageAccessError("network");
    }
    if (status !== 200 || !body?.access_token) {
      // 取り消された・アプリが消された。接続し直してもらう。
      throw new StorageAccessError("auth");
    }
    this.current = toAccessToken({ ...body, access_token: body.access_token });
    return this.current.value;
  }
}
