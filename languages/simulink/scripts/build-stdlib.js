// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildSimulinkCleanroomSchemas } from "../src/catalog/simulink-std-schemas.ts";

const simulinkDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(simulinkDir, "assets", "simulink-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

const schemas = buildSimulinkCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

buildCleanroomStdLib({
  langName: "simulink",
  packageName: "@modelscript/simulink-std-lib",
  description: `Cleanroom Simulink standard blockset library (${schemas.length} blocks, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(simulinkDir, "src", "catalog", "simulink-std-lib-data.ts"),
  constPrefix: "SIMULINK_STD_LIB",
  wasmGetterName: "getSimulinkStdLibWasmBytes",
});
