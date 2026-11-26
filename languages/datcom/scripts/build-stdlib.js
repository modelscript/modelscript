// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildDatcomCleanroomSchemas } from "../src/catalog/datcom-std-schemas.ts";

const datcomDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(datcomDir, "assets", "datcom-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildDatcomCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "datcom",
  packageName: "@modelscript/datcom-std-lib",
  description: `Cleanroom USAF Digital DATCOM NACA airfoil & aircraft configuration standard library (${schemas.length} schemas, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(datcomDir, "src", "catalog", "datcom-std-lib-data.ts"),
  constPrefix: "DATCOM_STD_LIB",
  wasmGetterName: "getDatcomStdLibWasmBytes",
});
