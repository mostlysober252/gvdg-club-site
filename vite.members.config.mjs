import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "members-app",
    emptyOutDir: true,
    sourcemap: true,
    modulePreload: false,
    rolldownOptions: {
      input: resolve(root, "src/members-app/main.js"),
      output: {
        entryFileNames: "members-app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
