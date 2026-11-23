// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildJedecCleanroomSchemas } from "../src/catalog/jedec-std-schemas.ts";

const jedecDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(jedecDir, "assets", "jedec-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildJedecCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "jedec",
  packageName: "@modelscript/jedec-std-lib",
  description: `Cleanroom JEDEC JESD3 classic 1980s PLD & field descriptor standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(jedecDir, "src", "catalog", "jedec-std-lib-data.ts"),
  constPrefix: "JEDEC_STD_LIB",
  wasmGetterName: "getJedecStdLibWasmBytes",
});
