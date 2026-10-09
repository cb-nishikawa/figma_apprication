/**
 * 外部の保存先（R2）に置くファイル構成と JSON の形。
 *
 *   metadata.json        この保存先がテンプレパレットくんのものだという印
 *   index.json           cbTemplatePalette.index
 *   tree.json            cbTemplatePalette.tree
 *   categories.json      cbTemplatePalette.categories
 *   items/<id>.json      cbTemplatePalette.item.<id>
 */

const KEY_PREFIX = "cbTemplatePalette.";
const ITEM_PREFIX = "cbTemplatePalette.item.";

export const ITEMS_FOLDER = "items";
export const METADATA_FILE = "metadata.json";
export const TEST_FILE = ".cbtemplate-connection-test";
export const METADATA_APP = "cbTemplatePalette";
export const METADATA_FORMAT_VERSION = 1;

/** 保存先の印。`name` は共有カテゴリとして追加するときの名前の初期値に使う。 */
export interface SourceMetadata {
  app: typeof METADATA_APP;
  formatVersion: number;
  createdAt: string;
  name?: string;
}

export interface FileLocation {
  name: string;
  inItems: boolean;
}

export function locate(key: string): FileLocation {
  if (key.startsWith(ITEM_PREFIX)) {
    return { name: `${encodeURIComponent(key.slice(ITEM_PREFIX.length))}.json`, inItems: true };
  }
  const name = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
  return { name: `${encodeURIComponent(name)}.json`, inItems: false };
}

/** 保存先の中での相対パス（`index.json`、`items/<id>.json`）。 */
export function locatePath(key: string): string {
  const location = locate(key);
  return location.inItems ? `${ITEMS_FOLDER}/${location.name}` : location.name;
}

export function newMetadata(name?: string): SourceMetadata {
  return {
    app: METADATA_APP,
    formatVersion: METADATA_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    ...(name ? { name } : {}),
  };
}

export function isMetadata(value: unknown): value is SourceMetadata {
  const metadata = value as SourceMetadata | null;
  return !!metadata && typeof metadata === "object" && metadata.app === METADATA_APP;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(128);
  for (let i = 0; i < BASE64.length; i += 1) {
    table[BASE64.charCodeAt(i)] = i;
  }
  return table;
})();

/** メインスレッドには btoa / atob が無いので自前で変換する。 */
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    chunk +=
      BASE64[a >> 2] +
      BASE64[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : "=") +
      (i + 2 < bytes.length ? BASE64[c & 63] : "=");
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  parts.push(chunk);
  return parts.join("");
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_LOOKUP[clean.charCodeAt(i)];
    const b = BASE64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? BASE64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? BASE64_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    bytes[offset++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) {
      bytes[offset++] = ((b & 15) << 4) | (c >> 2);
    }
    if (i + 3 < clean.length) {
      bytes[offset++] = ((c & 3) << 6) | d;
    }
  }
  return bytes.subarray(0, offset);
}

/**
 * clientStorage と同じく Uint8Array をそのまま持てるよう、`{"$u8": base64}` にして JSON にする。
 * 送る本文の文字コードに左右されないよう、ASCII 以外は \uXXXX にしておく。
 */
export function encodeValue(value: unknown): string {
  const text: string | undefined = JSON.stringify(value, (_key, entry: unknown) =>
    entry instanceof Uint8Array ? { $u8: toBase64(entry) } : entry
  );
  return (text ?? "null").replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function decodeValue(text: string): unknown {
  return JSON.parse(text, (_key, entry: unknown) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const keys = Object.keys(entry);
      const encoded = (entry as { $u8?: unknown }).$u8;
      if (keys.length === 1 && typeof encoded === "string") {
        return fromBase64(encoded);
      }
    }
    return entry;
  });
}
