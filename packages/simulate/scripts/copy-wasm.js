// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const srcWasm = path.join(pkgDir, "src", "wasm");
const distWasm = path.join(pkgDir, "dist", "wasm");

export function copyWasm() {
  if (fs.existsSync(srcWasm)) {
    fs.mkdirSync(distWasm, { recursive: true });
    for (const file of fs.readdirSync(srcWasm)) {
      if (file.endsWith(".wasm") || file.endsWith(".js") || file.endsWith(".d.ts")) {
        fs.copyFileSync(path.join(srcWasm, file), path.join(distWasm, file));
      }
    }
  }
}

copyWasm();
