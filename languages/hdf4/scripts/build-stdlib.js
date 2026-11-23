// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildHdf4CleanroomSchemas } from "../src/catalog/hdf4-std-schemas.ts";

const hdf4Dir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(hdf4Dir, "assets", "hdf4-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildHdf4CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "hdf4",
  packageName: "@modelscript/hdf4-std-lib",
  description: `Cleanroom NCSA HDF4 & NASA EOS-HDF standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(hdf4Dir, "src", "catalog", "hdf4-std-lib-data.ts"),
  constPrefix: "HDF4_STD_LIB",
  wasmGetterName: "getHdf4StdLibWasmBytes",
});
