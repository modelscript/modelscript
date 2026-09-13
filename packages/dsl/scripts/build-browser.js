import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

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
    external: ["typescript", "module", "node:*", "esbuild", "child_process", "crypto", "tty"],
    define: {
      __filename: '"/"',
      __dirname: '"/"',
    },
    inject: [path.join(__dirname, "process-polyfill.js")],
  })
  .then(() => {
    console.log("DSL browser bundle created at dist/browser.js");

    // Build self-hosted typescript bundle for browser playground workers
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
  })
  .catch((err) => {
    console.error("Failed to build browser bundle:", err);
    process.exit(1);
  });
