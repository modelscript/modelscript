// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildIrig106CleanroomSchemas } from "../src/catalog/irig106-std-schemas.ts";

const irig106Dir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(irig106Dir, "assets", "irig106-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildIrig106CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "irig106",
  packageName: "@modelscript/irig106-std-lib",
  description: `Cleanroom IRIG 106 Chapter 9 TMATS standard library (${schemas.length} schemas: TMATS groups G/T/M/P/D/C and IRIG-106 standard sync words, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(irig106Dir, "src", "catalog", "irig106-std-lib-data.ts"),
  constPrefix: "IRIG106_STD_LIB",
  wasmGetterName: "getIrig106StdLibWasmBytes",
});
