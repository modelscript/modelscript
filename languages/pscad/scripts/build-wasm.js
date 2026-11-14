// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { runLanguageWasmBuild } from "../../../scripts/build-language-wasm.js";

const pscadDir = new URL("..", import.meta.url).pathname;

runLanguageWasmBuild({
  langName: "pscad",
  dir: pscadDir,
  entryFile: "assembly/psout.ts",
  outWasmFile: "dist/psout.wasm",
});

// Option B: Build @modelscript/pscad-master-lib/dist from src/
const masterLibDir = path.join(pscadDir, "assets", "pscad-master-lib");
const masterLibSrc = path.join(masterLibDir, "src");
const masterLibDist = path.join(masterLibDir, "dist");
fs.mkdirSync(masterLibDist, { recursive: true });
for (const file of ["symbols.json", "diagrams.json"]) {
  const srcFile = path.join(masterLibSrc, file);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(masterLibDist, file));
  }
}

runLanguageWasmBuild({
  langName: "pscad-master-lib",
  dir: masterLibDir,
  entryFile: "src/companions.ts",
  outWasmFile: "dist/runtime.wasm",
});
