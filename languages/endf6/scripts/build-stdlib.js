// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildEndf6CleanroomSchemas } from "../src/catalog/endf6-std-schemas.ts";

const endf6Dir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(endf6Dir, "assets", "endf6-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildEndf6CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "endf6",
  packageName: "@modelscript/endf6-std-lib",
  description: `Cleanroom ENDF-6 MF/MT reaction schemas and reference nuclides (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(endf6Dir, "src", "catalog", "endf6-std-lib-data.ts"),
  constPrefix: "ENDF6_STD_LIB",
  wasmGetterName: "getEndf6StdLibWasmBytes",
});
