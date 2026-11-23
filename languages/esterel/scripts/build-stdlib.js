// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildEsterelCleanroomSchemas } from "../src/catalog/esterel-std-schemas.ts";

const esterelDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(esterelDir, "assets", "esterel-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildEsterelCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "esterel",
  packageName: "@modelscript/esterel-std-lib",
  description: `Cleanroom Esterel synchronous reactive standard library (${schemas.length} canonical patterns, SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(esterelDir, "src", "catalog", "esterel-std-lib-data.ts"),
  constPrefix: "ESTEREL_STD_LIB",
  wasmGetterName: "getEsterelStdLibWasmBytes",
});
