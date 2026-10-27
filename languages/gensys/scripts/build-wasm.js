// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageWasmBuild } from "../../../scripts/build-language-wasm.js";

runLanguageWasmBuild({
  langName: "gensys",
  dir: new URL("..", import.meta.url).pathname,
  entryFile: "assembly/contact.ts",
  outWasmFile: "dist/contact.wasm",
  binaryTsFile: "src/contact/wasm-binary.ts",
  base64ConstName: "CONTACT_WASM_BASE64",
  binaryGetterName: "getContactWasmBinary",
  description: "Pre-compiled WebAssembly binary payload for GENSYS Contact Mechanics Kernel.",
});
