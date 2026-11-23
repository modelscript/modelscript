// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildIucrCifCleanroomSchemas } from "../src/catalog/iucr-cif-std-schemas.ts";

const pkgDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(pkgDir, "assets", "iucr-cif-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG icons) from declarative schemas
const schemas = buildIucrCifCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "iucr-cif",
  packageName: "@modelscript/iucr-cif-std-lib",
  description: `Cleanroom IUCr CIF 1.1 dictionary & canonical crystal standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(pkgDir, "src", "catalog", "iucr-cif-std-lib-data.ts"),
  constPrefix: "IUCR_CIF_STD_LIB",
  wasmGetterName: "getIucrCifStdLibWasmBytes",
});
