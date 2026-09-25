/// <reference types="vite/client" />

declare module "@jsquash/avif/codec/enc/avif_enc.js" {
  interface AvifEncoderModule {
    encode(
      data: Uint8Array,
      width: number,
      height: number,
      options: Record<string, unknown>
    ): Uint8Array | null;
  }
  const factory: (opts?: {
    wasmBinary: Uint8Array;
    locateFile: (path: string) => string;
  }) => Promise<AvifEncoderModule>;
  export default factory;
}