// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildGpromsCleanroomSchemas } from "../src/catalog/gproms-std-schemas.ts";

const gpromsDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(gpromsDir, "assets", "gproms-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildGpromsCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "gproms",
  packageName: "@modelscript/gproms-std-lib",
  description: `Cleanroom gPROMS Process Model Library (PML) & thermodynamic property package standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(gpromsDir, "src", "catalog", "gproms-std-lib-data.ts"),
  constPrefix: "GPROMS_STD_LIB",
  wasmGetterName: "getGpromsStdLibWasmBytes",
});
