// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildLsDynaCleanroomSchemas } from "../src/catalog/lsdyna-std-schemas.ts";

const lsdynaDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(lsdynaDir, "assets", "lsdyna-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildLsDynaCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "lsdyna",
  packageName: "@modelscript/lsdyna-std-lib",
  description: `Cleanroom LS-DYNA / DYNA3D explicit dynamics material & section standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(lsdynaDir, "src", "catalog", "lsdyna-std-lib-data.ts"),
  constPrefix: "LSDYNA_STD_LIB",
  wasmGetterName: "getLsDynaStdLibWasmBytes",
});
