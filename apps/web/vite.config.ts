// SPDX-License-Identifier: AGPL-3.0-or-later

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths({ root: import.meta.dirname })],
  build: {
    target: "esnext",
    minify: false,
  },
  define: {
    "process.env": {},
  },
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      "/api/models": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
      },
      "/api/languages": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
      },
      "/api/github": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/vscode": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
        ws: true,
      },
      "/vscode-static": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
      },
      "/static": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
      },
    },
  },
});
