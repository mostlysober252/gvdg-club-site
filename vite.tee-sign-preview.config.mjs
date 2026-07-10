import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "tee-sign-preview-app",
    emptyOutDir: true,
    sourcemap: true,
    modulePreload: false,
    rolldownOptions: {
      input: resolve(root, "src/tee-sign-preview-app/main.js"),
      output: {
        entryFileNames: "tee-sign-preview-app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
