// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildGpssCleanroomSchemas } from "../src/catalog/gpss-std-schemas.ts";

const gpssDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(gpssDir, "assets", "gpss-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildGpssCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "gpss",
  packageName: "@modelscript/gpss-std-lib",
  description: `Cleanroom GPSS (General Purpose Simulation System, 1961) discrete-event standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(gpssDir, "src", "catalog", "gpss-std-lib-data.ts"),
  constPrefix: "GPSS_STD_LIB",
  wasmGetterName: "getGpssStdLibWasmBytes",
});
