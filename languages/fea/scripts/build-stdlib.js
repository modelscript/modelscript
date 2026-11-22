// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildFeaCleanroomSchemas } from "../src/catalog/fea-std-schemas.ts";

const feaDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(feaDir, "assets", "fea-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildFeaCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "fea",
  packageName: "@modelscript/fea-std-lib",
  description: `Cleanroom Abaqus & NASTRAN standard element, section, and constitutive material library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(feaDir, "src", "catalog", "fea-std-lib-data.ts"),
  constPrefix: "FEA_STD_LIB",
  wasmGetterName: "getFeaStdLibWasmBytes",
});
