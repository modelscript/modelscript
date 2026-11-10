// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const srcWasm = path.join(pkgDir, "src", "wasm");
const distWasm = path.join(pkgDir, "dist", "wasm");

export function copyWasm() {
  const dirs = [path.join(pkgDir, "src", "wasm"), path.join(pkgDir, "wasm")];
  for (const srcDir of dirs) {
    if (fs.existsSync(srcDir)) {
      fs.mkdirSync(distWasm, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        if (file.endsWith(".wasm") || file.endsWith(".js") || file.endsWith(".d.ts")) {
          fs.copyFileSync(path.join(srcDir, file), path.join(distWasm, file));
        }
      }
    }
  }
}

copyWasm();
