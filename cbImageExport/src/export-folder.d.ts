/**
 * File System Access API surface used for folder export (Chrome/Edge).
 * lib.dom already provides FileSystemDirectoryHandle / FileSystemWritableFileStream;
 * only the Window entry point is missing.
 */
export {};

declare global {
  interface Window {
    showDirectoryPicker(options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}