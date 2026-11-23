// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildUsgsDemCleanroomSchemas } from "../src/catalog/usgs-dem-std-schemas.ts";

const usgsDemDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(usgsDemDir, "assets", "usgs-dem-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildUsgsDemCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "usgs-dem",
  packageName: "@modelscript/usgs-dem-std-lib",
  description: `Cleanroom USGS Digital Elevation Model datum, synthetic terrain & geomorphometry standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(usgsDemDir, "src", "catalog", "usgs-dem-std-lib-data.ts"),
  constPrefix: "USGS_DEM_STD_LIB",
  wasmGetterName: "getUsgsDemStdLibWasmBytes",
});
