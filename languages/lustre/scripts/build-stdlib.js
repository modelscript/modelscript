// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildLustreCleanroomSchemas } from "../src/catalog/lustre-std-schemas.ts";

const lustreDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(lustreDir, "assets", "lustre-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildLustreCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "lustre",
  packageName: "@modelscript/lustre-std-lib",
  description: `Cleanroom Lustre/SCADE synchronous temporal operator standard library (${schemas.length} operators, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(lustreDir, "src", "catalog", "lustre-std-lib-data.ts"),
  constPrefix: "LUSTRE_STD_LIB",
  wasmGetterName: "getLustreStdLibWasmBytes",
});
