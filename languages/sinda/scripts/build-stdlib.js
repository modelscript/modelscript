// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildSindaCleanroomSchemas } from "../src/catalog/sinda-std-schemas.ts";

const sindaDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(sindaDir, "assets", "sinda-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildSindaCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "sinda",
  packageName: "@modelscript/sinda-std-lib",
  description: `Cleanroom NASA SINDA thermal solver routines & spacecraft thermal material catalog (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(sindaDir, "src", "catalog", "sinda-std-lib-data.ts"),
  constPrefix: "SINDA_STD_LIB",
  wasmGetterName: "getSindaStdLibWasmBytes",
});
