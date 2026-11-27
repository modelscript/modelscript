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
  const fs = await import("fs");
  const commonOptions: esbuild.BuildOptions = {
    bundle: true,
    platform: "browser",
    target: "es2022",
    minify: true,
    keepNames: true,
    sourcemap: "linked",
    banner: {
      js: `${BROWSER_PROCESS_BANNER}\n`,
    },
    define: {
      "process.env": "{}",
      "process.browser": "true",
    },
    inject: [path.join(__dirname, "process-polyfill.js")],
    logOverride: {
      "empty-import-meta": "silent",
    },
    plugins: [ignorePlugin],
  };

  const browserOutDir = path.join(pkgDir, "dist", "browser");
  if (fs.existsSync(browserOutDir)) {
    fs.rmSync(browserOutDir, { recursive: true, force: true });
  }
  console.log("Bundling classic IIFE browserServerMain.ts and simWorker.ts with esbuild...");
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.resolve(pkgDir, "src/browserServerMain.ts"), path.resolve(pkgDir, "src/simWorker.ts")],
    outdir: browserOutDir,
    format: "iife",
    banner: {
      js: `${BROWSER_PROCESS_BANNER}\nvar process = globalThis.process;\n`,
    },
    define: {
      ...commonOptions.define,
      "import.meta.url": "self.location.href",
    },
  });

  const esmOutDir = path.join(pkgDir, "dist", "esm");
  if (fs.existsSync(esmOutDir)) {
    fs.rmSync(esmOutDir, { recursive: true, force: true });
  }
  console.log("Bundling code-split ESM browserServerMain.ts with esbuild...");
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.resolve(pkgDir, "src/browserServerMain.ts")],
    outdir: esmOutDir,
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
  });
  console.log("Bundle completed successfully!");

  const assetGz = path.resolve(pkgDir, "assets/msl-icons.json.gz");
  const distGz = path.resolve(pkgDir, "dist/msl-icons.json.gz");
  if (fs.existsSync(assetGz)) {
    fs.copyFileSync(assetGz, distGz);
    console.log("Copied msl-icons.json.gz to dist/");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
