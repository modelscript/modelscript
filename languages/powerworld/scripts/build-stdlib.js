// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildPowerWorldCleanroomSchemas } from "../src/catalog/powerworld-std-schemas.ts";

const powerworldDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(powerworldDir, "assets", "powerworld-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildPowerWorldCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "powerworld",
  packageName: "@modelscript/powerworld-std-lib",
  description: `Cleanroom PowerWorld Simulator / IEEE / WECC standard dynamic model library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(powerworldDir, "src", "catalog", "powerworld-std-lib-data.ts"),
  constPrefix: "POWERWORLD_STD_LIB",
  wasmGetterName: "getPowerWorldStdLibWasmBytes",
});
