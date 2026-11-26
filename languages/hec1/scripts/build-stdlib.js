// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildHec1CleanroomSchemas } from "../src/catalog/hec1-std-schemas.ts";

const hec1Dir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(hec1Dir, "assets", "hec1-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildHec1CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "hec1",
  packageName: "@modelscript/hec1-std-lib",
  description: `Cleanroom USACE HEC-1 / USDA TR-55 hydrologic standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(hec1Dir, "src", "catalog", "hec1-std-lib-data.ts"),
  constPrefix: "HEC1_STD_LIB",
  wasmGetterName: "getHec1StdLibWasmBytes",
});
