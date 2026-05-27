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
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
