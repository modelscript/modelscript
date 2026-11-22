// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildEclipseCleanroomSchemas } from "../src/catalog/eclipse-std-schemas.ts";

const eclipseDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(eclipseDir, "assets", "eclipse-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildEclipseCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "eclipse",
  packageName: "@modelscript/eclipse-std-lib",
  description: `Cleanroom SLB ECLIPSE / OPM Flow standard reservoir physics library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(eclipseDir, "src", "catalog", "eclipse-std-lib-data.ts"),
  constPrefix: "ECLIPSE_STD_LIB",
  wasmGetterName: "getEclipseStdLibWasmBytes",
});
