// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildAspenCleanroomSchemas } from "../src/catalog/aspen-std-schemas.ts";

const aspenDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(aspenDir, "assets", "aspen-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildAspenCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "aspen",
  packageName: "@modelscript/aspen-std-lib",
  description: `Cleanroom Aspen Plus / HYSYS standard library (${schemas.length} unit operation, property method, and NIST pure component schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(aspenDir, "src", "catalog", "aspen-std-lib-data.ts"),
  constPrefix: "ASPEN_STD_LIB",
  wasmGetterName: "getAspenStdLibWasmBytes",
});
