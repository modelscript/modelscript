// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageWasmBuild } from "../../../scripts/build-language-wasm.js";

runLanguageWasmBuild({
  langName: "relap5",
  dir: new URL("..", import.meta.url).pathname,
  entryFile: "assembly/point_kinetics.ts",
  outWasmFile: "dist/point_kinetics.wasm",
  binaryTsFile: "src/solvers/wasm-binary.ts",
  base64ConstName: "POINT_KINETICS_WASM_BASE64",
  binaryGetterName: "getPointKineticsWasmBinary",
  description: "Pre-compiled WebAssembly binary payload for RELAP5 Point Kinetics Kernel.",
});
