// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildMlxtranCleanroomSchemas } from "../src/catalog/mlxtran-std-schemas.ts";

const mlxtranDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(mlxtranDir, "assets", "mlxtran-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildMlxtranCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "mlxtran",
  packageName: "@modelscript/mlxtran-std-lib",
  description: `Cleanroom Monolix Mlxtran PK/PD/TMDD/TGI standard model library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(mlxtranDir, "src", "catalog", "mlxtran-std-lib-data.ts"),
  constPrefix: "MLXTRAN_STD_LIB",
  wasmGetterName: "getMlxtranStdLibWasmBytes",
});
