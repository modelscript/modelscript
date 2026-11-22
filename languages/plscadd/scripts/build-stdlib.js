// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildPlsCaddCleanroomSchemas } from "../src/catalog/plscadd-std-schemas.ts";

const plscaddDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(plscaddDir, "assets", "plscadd-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom parametric SVG icons) from declarative schemas
const schemas = buildPlsCaddCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "plscadd",
  packageName: "@modelscript/plscadd-std-lib",
  description: `Cleanroom Bentley PLS-CADD overhead transmission line standard library (${schemas.length} schemas: ASTM/IEC conductors, ASCE structures, insulators, NESC C2 / IEC 60826 load cases, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(plscaddDir, "src", "catalog", "plscadd-std-lib-data.ts"),
  constPrefix: "PLSCADD_STD_LIB",
  wasmGetterName: "getPlsCaddStdLibWasmBytes",
});
