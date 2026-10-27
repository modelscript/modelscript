// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageWasmBuild } from "../../../scripts/build-language-wasm.js";

runLanguageWasmBuild({
  langName: "simpack",
  dir: new URL("..", import.meta.url).pathname,
  entryFile: "assembly/kinematics.ts",
  outWasmFile: "dist/kinematics.wasm",
  binaryTsFile: "src/kinematics/wasm-binary.ts",
  base64ConstName: "KINEMATICS_WASM_BASE64",
  binaryGetterName: "getKinematicsWasmBinary",
  description: "Pre-compiled WebAssembly binary payload for SIMPACK Multibody Kinematics Kernel.",
});
