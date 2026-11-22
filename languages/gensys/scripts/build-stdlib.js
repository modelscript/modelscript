// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildGensysCleanroomSchemas } from "../src/catalog/gensys-std-schemas.ts";

const gensysDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(gensysDir, "assets", "gensys-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG icons) from declarative schemas
const schemas = buildGensysCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "gensys",
  packageName: "@modelscript/gensys-std-lib",
  description: `Cleanroom DEsolver GENSYS rail multibody coupling & profile library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(gensysDir, "src", "catalog", "gensys-std-lib-data.ts"),
  constPrefix: "GENSYS_STD_LIB",
  wasmGetterName: "getGensysStdLibWasmBytes",
});
