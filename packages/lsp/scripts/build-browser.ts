// SPDX-License-Identifier: AGPL-3.0-or-later

import { BROWSER_PROCESS_BANNER, createNodeBuiltinsIgnorePlugin } from "@modelscript/dsl";
import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

const ignorePlugin = createNodeBuiltinsIgnorePlugin();

async function run() {
  console.log("Bundling browserServerMain.ts and indexer.worker.ts with esbuild...");
  await esbuild.build({
    entryPoints: [
      path.resolve(pkgDir, "src/browserServerMain.ts"),
      path.resolve(pkgDir, "src/workers/indexer.worker.ts"),
    ],
    outdir: path.join(pkgDir, "dist"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: false,
    keepNames: true,
    sourcemap: "linked",
    banner: {
      js: `${BROWSER_PROCESS_BANNER}\nvar process = globalThis.process;\n`,
    },
    define: {
      "process.env": "{}",
      "process.browser": "true",
      "import.meta.url": "self.location.href",
    },
    inject: [path.join(__dirname, "process-polyfill.js")],
    logOverride: {
      "duplicate-object-key": "silent",
      "empty-import-meta": "silent",
    },
    plugins: [ignorePlugin],
  });
  console.log("Bundle completed successfully!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
