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
          include: ["buffer", "crypto", "fs", "path", "process", "stream", "util", "vm"],
          protocolImports: false,
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
    ssr: {
      noExternal: ["@primer/react", "monaco-editor"],
    },
  };
});
