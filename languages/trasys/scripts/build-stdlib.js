// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildTrasysCleanroomSchemas } from "../src/catalog/trasys-std-schemas.ts";

const trasysDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(trasysDir, "assets", "trasys-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildTrasysCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "trasys",
  packageName: "@modelscript/trasys-std-lib",
  description: `Cleanroom NASA TRASYS thermal radiation & spacecraft coating standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(trasysDir, "src", "catalog", "trasys-std-lib-data.ts"),
  constPrefix: "TRASYS_STD_LIB",
  wasmGetterName: "getTrasysStdLibWasmBytes",
});
