// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildSrecCleanroomSchemas } from "../src/catalog/srec-std-schemas.ts";

const srecDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(srecDir, "assets", "srec-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildSrecCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "srec",
  packageName: "@modelscript/srec-std-lib",
  description: `Cleanroom Motorola S-Record (S0–S9) & 6800/68000/ColdFire/PowerPC memory map standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(srecDir, "src", "catalog", "srec-std-lib-data.ts"),
  constPrefix: "SREC_STD_LIB",
  wasmGetterName: "getSrecStdLibWasmBytes",
});
