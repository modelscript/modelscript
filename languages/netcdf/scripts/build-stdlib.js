// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildNetcdfCleanroomSchemas } from "../src/catalog/netcdf-std-schemas.ts";

const netcdfDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(netcdfDir, "assets", "netcdf-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildNetcdfCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "netcdf",
  packageName: "@modelscript/netcdf-std-lib",
  description: `Cleanroom Unidata NetCDF Classic & CF-1.x standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(netcdfDir, "src", "catalog", "netcdf-std-lib-data.ts"),
  constPrefix: "NETCDF_STD_LIB",
  wasmGetterName: "getNetcdfStdLibWasmBytes",
});
