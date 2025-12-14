import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    nodePolyfills({ include: ["buffer", "fs", "path"], protocolImports: true }),
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
});
