// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildSegyCleanroomSchemas } from "../src/catalog/segy-std-schemas.ts";

const segyDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(segyDir, "assets", "segy-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildSegyCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "segy",
  packageName: "@modelscript/segy-std-lib",
  description: `Cleanroom SEG-Y Rev 0 / Rev 1 header schemas and standard seismic wavelets (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(segyDir, "src", "catalog", "segy-std-lib-data.ts"),
  constPrefix: "SEGY_STD_LIB",
  wasmGetterName: "getSegyStdLibWasmBytes",
});
