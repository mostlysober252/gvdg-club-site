import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "score-app",
    emptyOutDir: true,
    sourcemap: true,
    modulePreload: false,
    rolldownOptions: {
      input: resolve(root, "src/score-app/main.js"),
      output: {
        entryFileNames: "score-app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
