import { zipSync } from "fflate";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function zipEntries(entries: ZipEntry[]): Uint8Array {
  const record: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    record[entry.name] = entry.data;
  }
  return zipSync(record);
}