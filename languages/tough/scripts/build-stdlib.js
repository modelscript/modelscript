// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildToughCleanroomSchemas } from "../src/catalog/tough-std-schemas.ts";

const toughDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(toughDir, "assets", "tough-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildToughCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "tough",
  packageName: "@modelscript/tough-std-lib",
  description: `Cleanroom LBNL TOUGH2 / TOUGH3 EOS & porous-media constitutive standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(toughDir, "src", "catalog", "tough-std-lib-data.ts"),
  constPrefix: "TOUGH_STD_LIB",
  wasmGetterName: "getToughStdLibWasmBytes",
});
