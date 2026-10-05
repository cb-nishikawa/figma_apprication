import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

export default defineConfig({
  plugins: [viteSingleFile()],
  root: resolve(__dirname, "src"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
    rollupOptions: {
      input: resolve(__dirname, "src/ui.html"),
      output: {
        entryFileNames: "ui.js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
