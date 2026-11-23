// SPDX-License-Identifier: AGPL-3.0-or-later

import * as esbuild from "esbuild";
import * as fs from "fs";
import { createRequire } from "module";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = __dirname;
const require = createRequire(import.meta.url);

// Resolve `@antv/layout` directly to its lightweight pure-JS `dagre` module so
// unused WebGL force shaders (`regl`, `dagre-compound`, `ml-matrix`, `g-webgpu`)
// are completely excluded from the standalone browser bundle.
const dagreOnlyPlugin = {
  name: "antv-layout-dagre-only",
  setup(build) {
    build.onResolve({ filter: /^@antv\/layout$/ }, () => {
      const layoutPkgPath = require.resolve("@antv/layout/package.json");
      const dagreEntry = path.join(path.dirname(layoutPkgPath), "es/layout/dagre.js");
      return { path: dagreEntry };
    });
  },
};

const outfile = path.join(pkgDir, "dist/diagram.browser.js");

esbuild
  .build({
    entryPoints: [path.join(pkgDir, "src/browser-entry.ts")],
    bundle: true,
    minify: true,
    treeShaking: true,
    target: "es2022",
    legalComments: "none",
    outfile,
    format: "esm",
    platform: "browser",
    plugins: [dagreOnlyPlugin],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  })
  .then(() => {
    const bytes = fs.statSync(outfile).size;
    console.log(`Diagram browser bundle created at dist/diagram.browser.js (${(bytes / 1024).toFixed(1)} KB)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
