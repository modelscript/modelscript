import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
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
    esbuild: {
      keepNames: true,
    },
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
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
              src: "../../packages/lsp/dist/browserServerMain.js",
              dest: "lsp/server/dist",
            },
            {
              src: "../../packages/lsp/dist/browserServerMain.js.map",
              dest: "lsp/server/dist",
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
          ],
        }),
    ],
    build: {
      rollupOptions: {
        output: isSsrBuild
          ? {}
          : {
              manualChunks: {
                monaco: ["monaco-editor"],
                x6: ["@antv/x6", "@antv/layout"],
                primer: ["@primer/react"],
                recharts: ["recharts"],
              },
            },
      },
    },
    resolve: {
      alias: {
        // web-tree-sitter 0.26.x imports "fs/promises" dynamically;
        // vite-plugin-node-polyfills maps "fs" → empty.js but not
        // "fs/promises", which Vite resolves as empty.js/promises (ENOTDIR).
        "fs/promises": "node-stdlib-browser/mock/empty",
      },
    },
    server: {
      port: 3002,
      strictPort: true,
      proxy: {
        "/api/v1": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    ssr: {
      noExternal: ["@primer/react", "monaco-editor"],
    },
  };
});
