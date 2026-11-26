// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildStlCleanroomSchemas } from "../src/catalog/stl-std-schemas.ts";

const stlDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(stlDir, "assets", "stl-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildStlCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "stl",
  packageName: "@modelscript/stl-std-lib",
  description: `Cleanroom 3D Systems STL analytical primitive standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(stlDir, "src", "catalog", "stl-std-lib-data.ts"),
  constPrefix: "STL_STD_LIB",
  wasmGetterName: "getStlStdLibWasmBytes",
});
