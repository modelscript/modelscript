// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildAmplCleanroomSchemas } from "../src/catalog/ampl-std-schemas.ts";

const amplDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(amplDir, "assets", "ampl-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildAmplCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "ampl",
  packageName: "@modelscript/ampl-std-lib",
  description: `Cleanroom AMPL standard math, probability, piecewise-linear, and aggregation library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(amplDir, "src", "catalog", "ampl-std-lib-data.ts"),
  constPrefix: "AMPL_STD_LIB",
  wasmGetterName: "getAmplStdLibWasmBytes",
});
