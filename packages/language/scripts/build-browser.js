import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

const patchX6Plugin = {
  name: "patch-x6",
  setup(build) {
    build.onEnd(async () => {
      const diagramFile = path.join(pkgDir, "dist/diagram.browser.js");
      if (fs.existsSync(diagramFile)) {
        let code = fs.readFileSync(diagramFile, "utf8");
        code = code.replace(
          /node\s*&&\s*node\.tagName\.toUpperCase\(\)/g,
          "node && (node.tagName || node.nodeName || '').toUpperCase()",
        );
        code = code.replace(
          /firstChild\s*&&\s*firstChild\.tagName\.toUpperCase\(\)/g,
          "firstChild && (firstChild.tagName || firstChild.nodeName || '').toUpperCase()",
        );
        fs.writeFileSync(diagramFile, code);
        console.log("Patched X6 TextNode tagName handling in dist/diagram.browser.js");
      }
    });
  },
};

esbuild
  .build({
    entryPoints: [path.join(pkgDir, "src/index.ts")],
    bundle: true,
    outfile: path.join(pkgDir, "dist/browser.js"),
    format: "esm",
    platform: "browser",
    alias: {
      os: path.join(__dirname, "os-polyfill.js"),
      fs: path.join(__dirname, "fs-polyfill.js"),
      path: path.join(__dirname, "path-polyfill.js"),
      url: path.join(__dirname, "path-polyfill.js"),
    },
    external: [
      "typescript",
      "module",
      "node:*",
      "opencascade.js",
      "opencascade.js/*",
      "aedes",
      "aedes-server-factory",
      "mqtt",
      "ws",
      "pg",
    ],
    define: {
      __filename: '"/"',
      __dirname: '"/"',
    },
    inject: [path.join(__dirname, "process-polyfill.js")],
  })
  .then(() => {
    console.log("Browser bundle created at dist/browser.js");

    // Create standalone diagram browser bundle
    return esbuild.build({
      entryPoints: [path.join(pkgDir, "src/diagram/index.ts")],
      bundle: true,
      outfile: path.join(pkgDir, "dist/diagram.browser.js"),
      format: "esm",
      platform: "browser",
      plugins: [patchX6Plugin],
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    });
  })
  .then(() => {
    console.log("Diagram browser bundle created at dist/diagram.browser.js");

    // Also create a standalone, self-hosted ESM bundle of typescript for the playground
    return esbuild.build({
      entryPoints: [path.resolve(pkgDir, "../../node_modules/typescript/lib/typescript.js")],
      bundle: true,
      minify: true,
      outfile: path.join(pkgDir, "dist/typescript.mjs"),
      format: "esm",
      platform: "browser",
      alias: {
        os: path.join(__dirname, "os-polyfill.js"),
        fs: path.join(__dirname, "fs-polyfill.js"),
      },
      define: {
        __filename: '"/"',
        __dirname: '"/"',
      },
      inject: [path.join(__dirname, "process-polyfill.js")],
    });
  })
  .then(() => {
    console.log("Self-hosted typescript bundle created at dist/typescript.mjs");

    // Also build the LSP browser server bundle
    return esbuild.build({
      entryPoints: [
        path.join(pkgDir, "src/lsp/browserServerMain.ts"),
        path.join(pkgDir, "src/lsp/step-worker.ts"),
        path.join(pkgDir, "src/lsp/workers/indexer.worker.ts"),
      ],
      outdir: path.join(pkgDir, "dist/lsp"),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: false,
      keepNames: true,
      sourcemap: "inline",
      define: {
        "process.env": "{}",
        "process.browser": "true",
        "import.meta.url": "''",
      },
      plugins: [
        {
          name: "node-builtins-ignore",
          setup(build) {
            const builtins = [
              "assert",
              "buffer",
              "child_process",
              "crypto",
              "diagnostics_channel",
              "events",
              "fs",
              "fs/promises",
              "http",
              "https",
              "module",
              "net",
              "os",
              "path",
              "process",
              "readline",
              "stream",
              "string_decoder",
              "tls",
              "url",
              "util",
              "worker_threads",
              "zlib",
              "assemblyscript",
              "assemblyscript/asc",
              "assemblyscript/dist/asc.js",
              "binaryen",
            ];
            const filter = new RegExp(
              `^(node:)?(?:${builtins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
            );
            build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "ignore" }));
            build.onLoad({ filter: /.*/, namespace: "ignore" }, () => ({ contents: "", loader: "js" }));
          },
        },
      ],
    });
  })
  .then(() => {
    console.log("LSP browser server bundle created at dist/lsp/browserServerMain.js");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
