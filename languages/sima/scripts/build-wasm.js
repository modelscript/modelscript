// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from "node:url";
import { runLanguageWasmBuild } from "../../../scripts/build/build-language-wasm.js";

runLanguageWasmBuild({
  langName: "sima",
  dir: fileURLToPath(new URL("..", import.meta.url)),
  entryFile: "assembly/catenary.ts",
  outWasmFile: "dist/catenary.wasm",
  binaryTsFile: "src/solver/wasm-binary.ts",
  base64ConstName: "CATENARY_WASM_BASE64",
  binaryGetterName: "getCatenaryWasmBinary",
  description: "Pre-compiled WebAssembly binary payload for SIMA Catenary Kernel.",
});
