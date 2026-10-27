// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageWasmBuild } from "../../../scripts/build-language-wasm.js";

runLanguageWasmBuild({
  langName: "pscad",
  dir: new URL("..", import.meta.url).pathname,
  entryFile: "assembly/psout.ts",
  outWasmFile: "dist/psout.wasm",
});
