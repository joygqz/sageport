import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Monaco is intentionally loaded on first file edit. Its editor core is a
    // single large module, so use a higher warning limit while keeping every
    // eagerly-loaded application chunk below the default 500 kB budget.
    chunkSizeWarningLimit: 4_000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 50,
            },
            {
              name: "radix-ui",
              test: /node_modules[\\/]@radix-ui[\\/]/,
              priority: 40,
            },
            {
              name: "xterm",
              test: /node_modules[\\/]@xterm[\\/]/,
              priority: 30,
            },
            {
              name: "markdown",
              test: /node_modules[\\/](react-markdown|remark-gfm)[\\/]/,
              priority: 30,
            },
          ],
        },
      },
    },
  },
}));
