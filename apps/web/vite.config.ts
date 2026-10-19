// SPDX-License-Identifier: AGPL-3.0-or-later

import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

interface StaticCopyTarget {
  src: string;
  dest: string;
  rename?: string;
}

function inlineStaticCopy(targets: StaticCopyTarget[]): Plugin {
  return {
    name: "inline-static-copy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = req.url?.split("?")[0] || "";
        for (const target of targets) {
          const fileName = target.rename || path.basename(target.src);
          const servedPath = "/" + path.join(target.dest, fileName).replace(/\\/g, "/");
          if (reqPath === servedPath) {
            const fullSrc = path.resolve(import.meta.dirname, target.src);
            if (fs.existsSync(fullSrc)) {
              if (fileName.endsWith(".wasm")) {
                res.setHeader("Content-Type", "application/wasm");
              } else if (fileName.endsWith(".js")) {
                res.setHeader("Content-Type", "application/javascript");
              } else if (fileName.endsWith(".zip")) {
                res.setHeader("Content-Type", "application/zip");
              }
              return fs.createReadStream(fullSrc).pipe(res);
            }
          }
        }
        next();
      });
    },
    async closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist");
      for (const target of targets) {
        const fullSrc = path.resolve(import.meta.dirname, target.src);
        if (fs.existsSync(fullSrc)) {
          const destDir = path.resolve(outDir, target.dest);
          await fs.promises.mkdir(destDir, { recursive: true });
          const destFile = path.resolve(destDir, target.rename || path.basename(target.src));
          await fs.promises.copyFile(fullSrc, destFile);
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths({ root: import.meta.dirname }),
    inlineStaticCopy(
      [
        // LSP WebWorker bundle + assets (WASM, standard library zips)
        // The LSP server resolves paths as ${extensionUri}/server/dist/...
        // With extensionUri = origin + "/lsp", files are served at /lsp/server/dist/...
        {
          src: "../../packages/lsp/dist/browserServerMain.js",
          dest: "lsp/server/dist",
        },
        {
          src: "../../packages/lsp/dist/workers/indexer.worker.js",
          dest: "lsp/server/dist/workers",
        },
        {
          src: "../../languages/modelica/dist/parser.wasm",
          dest: "lsp/server/dist",
          rename: "modelica.wasm",
        },
        {
          src: "../../languages/sysml2/dist/parser.wasm",
          dest: "lsp/server/dist",
          rename: "sysml2.wasm",
        },
        {
          src: "../../languages/step/dist/parser.wasm",
          dest: "lsp/server/dist",
          rename: "step.wasm",
        },
        {
          src: "../../languages/owl2/dist/parser.wasm",
          dest: "lsp/server/dist",
          rename: "owl2.wasm",
        },
        {
          src: "../../languages/csv/dist/parser.wasm",
          dest: "lsp/server/dist",
          rename: "csv.wasm",
        },
        {
          src: "../../languages/scad/dist/parser.wasm",
          dest: "lsp/server/dist",
          rename: "scad.wasm",
        },
        {
          src: "../../packages/runtime/build/release.wasm",
          dest: "lsp/server/dist",
        },
        {
          src: "../../node_modules/occt-import-js/dist/occt-import-js.wasm",
          dest: "lsp/server/dist",
        },
        {
          src: "../../scripts/ModelicaStandardLibrary_v4.1.0.zip",
          dest: "lsp/server/dist",
        },
        {
          src: "../../scripts/SysML-v2-Release-2026-03.zip",
          dest: "lsp/server/dist",
        },
      ].filter((t) => fs.existsSync(path.resolve(import.meta.dirname, t.src))),
    ),
  ],
  build: {
    target: "esnext",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("monaco-editor") || id.includes("@monaco-editor")) {
              return "vendor-monaco";
            }
            if (id.includes("three") || id.includes("@react-three")) {
              return "vendor-three";
            }
            if (
              id.includes("mermaid") ||
              id.includes("cytoscape") ||
              id.includes("dagre") ||
              id.includes("katex") ||
              id.includes("elkjs")
            ) {
              return "vendor-mermaid";
            }
            if (id.includes("@antv")) {
              return "vendor-antv";
            }
            if (id.includes("recharts") || id.includes("d3-scale") || id.includes("vega")) {
              return "vendor-charts";
            }
            if (id.includes("@primer")) {
              return "vendor-primer";
            }
          }
        },
      },
    },
  },
  define: {
    "process.env": {},
    "process.browser": true,
    "process.versions": {},
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom", "styled-components", "@primer/react", "three"],
  },
  optimizeDeps: {
    include: [
      "@antv/layout",
      "@antv/x6",
      "@monaco-editor/react",
      "@primer/octicons-react",
      "@primer/react",
      "@react-three/drei",
      "@react-three/fiber",
      "pako",
      "recharts",
      "three",
    ],
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
      "/.well-known": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/nodeinfo": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/actor": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/thumbnails": {
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
