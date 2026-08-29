import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ isSsrBuild }) => {
  return {
    define: {
      "process.env": {},
      "process.browser": true,
      "process.versions": {},
    },

    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths({ root: import.meta.dirname }),
      !isSsrBuild &&
        nodePolyfills({
          include: ["buffer", "fs", "path", "process"],
          protocolImports: false,
        }),
      !isSsrBuild &&
        viteStaticCopy({
          targets: [
            // LSP WebWorker bundle + assets (WASM, standard library zips)
            // The LSP server resolves paths as ${extensionUri}/server/dist/...
            // With extensionUri = origin + "/lsp", files are served at /lsp/server/dist/...
            {
              src: "../../packages/language/dist/lsp/browserServerMain.js",
              dest: "lsp/server/dist",
            },
            {
              src: "../../packages/language/dist/lsp/workers/indexer.worker.js",
              dest: "lsp/server/dist/workers",
            },
            {
              src: "../../node_modules/web-tree-sitter/web-tree-sitter.wasm",
              dest: "lsp/server/dist",
            },
            {
              src: "../../languages/modelica/tree-sitter-modelica.wasm",
              dest: "lsp/server/dist",
            },
            {
              src: "../../languages/sysml2/tree-sitter-sysml2.wasm",
              dest: "lsp/server/dist",
            },
            {
              src: "../../languages/step/tree-sitter-step.wasm",
              dest: "lsp/server/dist",
            },
            {
              src: "../../languages/owl2/tree-sitter-owl2.wasm",
              dest: "lsp/server/dist",
            },
            {
              src: "../../packages/language/build/release.wasm",
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
        }),
    ],
    build: {
      target: "esnext",
      minify: false,
    },
    resolve: {
      dedupe: ["react", "react-dom", "react-router", "styled-components", "@primer/react", "three"],
      alias: {
        // web-tree-sitter 0.26.x imports "fs/promises" dynamically;
        // vite-plugin-node-polyfills maps "fs" → empty.js but not
        // "fs/promises", which Vite resolves as empty.js/promises (ENOTDIR).
        "fs/promises": "node-stdlib-browser/mock/empty",
      },
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
        "@react-three/xr",
        "lodash",
        "lodash/debounce",
        "lodash.debounce",
        "monaco-editor",
        "mqtt",
        "pako",
        "papaparse",
        "parse-data-url",
        "react",
        "react-dom",
        "react-dropzone",
        "react-markdown",
        "recharts",
        "styled-components",
        "three",
        "vscode-languageserver-protocol/browser",
      ],
    },
    server: {
      port: 3002,
      strictPort: true,
      fs: {
        allow: [path.resolve(import.meta.dirname, "../..")],
      },
      proxy: {
        "/api/v1": {
          target: "http://127.0.0.1:3000",
          changeOrigin: true,
        },
      },
    },
    ssr: {
      noExternal: ["@primer/react", "monaco-editor"],
    },
  };
});
