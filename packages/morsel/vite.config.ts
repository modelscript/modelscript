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
    },
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
      isSsrBuild === false &&
        nodePolyfills({
          include: ["buffer", "fs", "path", "process"],
          protocolImports: false,
        }),
      isSsrBuild === false &&
        viteStaticCopy({
          targets: [
            {
              src: "./node_modules/web-tree-sitter/tree-sitter.wasm",
              dest: "",
            },
            {
              src: "../../node_modules/@modelscript/tree-sitter-modelica/tree-sitter-modelica.wasm",
              dest: "",
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
    server: {
      port: 5173,
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
