// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { runLanguageWasmBuild } from "../../../scripts/build-language-wasm.js";

const psseDir = new URL("..", import.meta.url).pathname;

// 1. Build @modelscript/psse native DYR scanner WASM kernel
runLanguageWasmBuild({
  langName: "psse-dyr",
  dir: psseDir,
  entryFile: "assembly/dyr-kernel.ts",
  outWasmFile: "dist/dyr-kernel.wasm",
  binaryTsFile: "src/parser/dyr-wasm-binary.ts",
  base64ConstName: "DYR_KERNEL_WASM_BASE64",
  binaryGetterName: "getDyrKernelWasmBinary",
  description: "Pre-compiled WebAssembly binary payload for PSS/E Linear-Memory DYR Scanner Kernel.",
});

// 2. Build @modelscript/psse-std-lib/dist from src/
const stdLibDir = path.join(psseDir, "assets", "psse-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
const stdLibDist = path.join(stdLibDir, "dist");
fs.mkdirSync(stdLibDist, { recursive: true });
for (const file of ["symbols.json", "diagrams.json"]) {
  const srcFile = path.join(stdLibSrc, file);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(stdLibDist, file));
  }
}

runLanguageWasmBuild({
  langName: "psse-std-lib",
  dir: stdLibDir,
  entryFile: "src/models.ts",
  outWasmFile: "dist/runtime.wasm",
});
