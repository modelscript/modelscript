// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

export function copyAssets() {
  const srcXmlDir = path.join(pkgDir, "src", "xml");
  const distXmlDir = path.join(pkgDir, "dist", "xml");

  if (fs.existsSync(srcXmlDir)) {
    const distSrcGenDir = path.join(distXmlDir, "src-gen");
    fs.mkdirSync(distSrcGenDir, { recursive: true });

    const assets = ["src-gen/bindings.js", "src-gen/bindings.d.ts", "parser.wasm"];

    for (const rel of assets) {
      const srcFile = path.join(srcXmlDir, rel);
      const distFile = path.join(distXmlDir, rel);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, distFile);
      }
    }
    console.log("Copied XML WASM parser and bindings to dist/xml");
  }
}

if (process.argv[1] === __filename) {
  copyAssets();
}
