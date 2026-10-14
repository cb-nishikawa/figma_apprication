/**
 * Dropbox との接続。アクセストークンは保存せず（dropboxAuth.ts がメモリにだけ持つ）、
 * 取り直しに使う refresh_token だけを端末の clientStorage に置く。「接続を解除」で消す。
 */
const SESSION_KEY = "cbTemplatePalette.dropboxSession";

export interface DropboxSession {
  refreshToken: string;
  accountId: string;
  email?: string;
}

export async function loadDropboxSession(): Promise<DropboxSession | null> {
  const stored = (await figma.clientStorage.getAsync(SESSION_KEY)) as Partial<DropboxSession> | undefined;
  if (!stored || typeof stored !== "object" || typeof stored.refreshToken !== "string" || !stored.refreshToken) {
    return null;
  }
  return {
    refreshToken: stored.refreshToken,
    accountId: typeof stored.accountId === "string" ? stored.accountId : "",
    ...(typeof stored.email === "string" ? { email: stored.email } : {}),
  };
}

export async function saveDropboxSession(session: DropboxSession | null): Promise<void> {
  if (session) {
    await figma.clientStorage.setAsync(SESSION_KEY, session);
  } else {
    await figma.clientStorage.deleteAsync(SESSION_KEY);
  }
}
