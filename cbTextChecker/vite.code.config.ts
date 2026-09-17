import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/code.ts"),
      formats: ["iife"],
      name: "TextCheckerPlugin",
      fileName: () => "code.js",
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
    target: "es2020",
    minify: false,
  },
});
