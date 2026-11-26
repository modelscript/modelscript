// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildCeaCleanroomSchemas } from "../src/catalog/cea-std-schemas.ts";

const ceaDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(ceaDir, "assets", "cea-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildCeaCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "cea",
  packageName: "@modelscript/cea-std-lib",
  description: `Cleanroom NASA CEA (RP-1311 / NIST-JANAF) thermodynamic species library (${schemas.length} species, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(ceaDir, "src", "catalog", "cea-std-lib-data.ts"),
  constPrefix: "CEA_STD_LIB",
  wasmGetterName: "getCeaStdLibWasmBytes",
});
