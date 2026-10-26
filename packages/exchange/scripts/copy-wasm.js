// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const srcDir = path.join(pkgDir, "src", "fmu", "pe-emulator", "wasm-engine");
const distDir = path.join(pkgDir, "dist", "fmu", "pe-emulator", "wasm-engine");

export function copyWasmAssets() {
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      if (file.endsWith(".wasm") || file.endsWith(".cjs")) {
        fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
      }
    }
  }
}

copyWasmAssets();
