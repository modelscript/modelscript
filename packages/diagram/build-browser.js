// SPDX-License-Identifier: AGPL-3.0-or-later

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = __dirname;

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
    outfile: path.join(pkgDir, "dist/diagram.browser.js"),
    format: "esm",
    platform: "browser",
    plugins: [patchX6Plugin],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  })
  .then(() => {
    console.log("Diagram browser bundle created at dist/diagram.browser.js");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
