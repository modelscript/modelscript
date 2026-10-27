// SPDX-License-Identifier: AGPL-3.0-or-later

import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import {
  BROWSER_BUFFER_AND_PROCESS_BANNER,
  createNodeBuiltinsIgnorePlugin,
} from "../packages/dsl/src/codegen/ide/esbuild-browser-plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(repoRoot, "apps/ide/dist/extension");
const ideDir = path.resolve(repoRoot, "packages/ide/src");

const ignorePlugin = createNodeBuiltinsIgnorePlugin();

console.log("Rebuilding browserClientMain.js and webviews...");
const startTime = Date.now();

await esbuild.build({
  entryPoints: [path.join(ideDir, "browser-client-main.ts")],
  outfile: path.join(outDir, "dist", "browserClientMain.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["vscode"],
  define: {
    "process.env": JSON.stringify({}),
    "process.browser": "true",
  },
  banner: {
    js: BROWSER_BUFFER_AND_PROCESS_BANNER,
  },
  plugins: [ignorePlugin],
  logOverride: {
    "duplicate-object-key": "silent",
    "empty-import-meta": "silent",
  },
  sourcemap: "linked",
});

await esbuild.build({
  entryPoints: [path.join(ideDir, "webview/diagram.ts")],
  outfile: path.join(outDir, "dist", "diagram.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  sourcemap: "linked",
  external: ["@kitware/vtk.js", "@kitware/vtk.js/*"],
  define: {
    "process.env": JSON.stringify({}),
    "process.browser": "true",
  },
  logOverride: {
    "duplicate-object-key": "silent",
    "empty-import-meta": "silent",
  },
});

console.log(`Rebuild completed in ${Date.now() - startTime}ms!`);
