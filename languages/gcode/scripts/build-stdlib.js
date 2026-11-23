// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildGCodeCleanroomSchemas } from "../src/catalog/gcode-std-schemas.ts";

const gcodeDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(gcodeDir, "assets", "gcode-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildGCodeCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "gcode",
  packageName: "@modelscript/gcode-std-lib",
  description: `Cleanroom ISO 6983 / RS-274 G-code, canned cycles & cutting-tool preset standard library (${schemas.length} schemas, SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(gcodeDir, "src", "catalog", "gcode-std-lib-data.ts"),
  constPrefix: "GCODE_STD_LIB",
  wasmGetterName: "getGCodeStdLibWasmBytes",
});
