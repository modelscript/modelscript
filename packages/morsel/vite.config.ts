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
    },
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
      isSsrBuild === false &&
        nodePolyfills({
          include: ["buffer", "crypto", "fs", "path", "stream", "util"],
          protocolImports: false,
          globals: {
            Buffer: true,
            global: true,
            process: true,
          },
        }),
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
    resolve: {
      alias:
        isSsrBuild !== false
          ? {
              // Force native node builtins for SSR, rely on polyfills for browser
              stream: "node:stream",
              crypto: "node:crypto",
              buffer: "node:buffer",
              util: "node:util",
              fs: "node:fs",
              path: "node:path",
              events: "node:events",
              "stream-browserify": "node:stream",
              "crypto-browserify": "node:crypto",
              "buffer-browserify": "node:buffer",
            }
          : undefined,
    },
    ssr: {
      noExternal: ["@primer/react", "monaco-editor"],
      external: [
        "node:buffer",
        "node:crypto",
        "node:events",
        "node:fs",
        "node:path",
        "node:stream",
        "node:util",
        "buffer",
        "crypto",
        "events",
        "fs",
        "path",
        "stream",
        "util",
      ],
    },
  };
});
