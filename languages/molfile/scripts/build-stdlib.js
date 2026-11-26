// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildMolfileCleanroomSchemas } from "../src/catalog/molfile-std-schemas.ts";

const molfileDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(molfileDir, "assets", "molfile-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildMolfileCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "molfile",
  packageName: "@modelscript/molfile-std-lib",
  description: `Cleanroom MDL Molfile/SDF periodic table and canonical molecule standard library (${schemas.length} schemas, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(molfileDir, "src", "catalog", "molfile-std-lib-data.ts"),
  constPrefix: "MOLFILE_STD_LIB",
  wasmGetterName: "getMolfileStdLibWasmBytes",
});
