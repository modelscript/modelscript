// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildEdifCleanroomSchemas } from "../src/catalog/edif-std-schemas.ts";

const edifDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(edifDir, "assets", "edif-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildEdifCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "edif",
  packageName: "@modelscript/edif-std-lib",
  description: `Cleanroom EDIF 2.0.0 GENERIC standard library (${schemas.length} cells, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(edifDir, "src", "catalog", "edif-std-lib-data.ts"),
  constPrefix: "EDIF_STD_LIB",
  wasmGetterName: "getEdifStdLibWasmBytes",
});
