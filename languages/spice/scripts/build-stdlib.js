// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildSpiceCleanroomSchemas } from "../src/catalog/spice-std-schemas.ts";

const spiceDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(spiceDir, "assets", "spice-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildSpiceCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "spice",
  packageName: "@modelscript/spice-std-lib",
  description: `Cleanroom SPICE / LTspice / PSpice standard semiconductor & behavioral primitive library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(spiceDir, "src", "catalog", "spice-std-lib-data.ts"),
  constPrefix: "SPICE_STD_LIB",
  wasmGetterName: "getSpiceStdLibWasmBytes",
});
