// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildTrnsysCleanroomSchemas } from "../src/catalog/trnsys-std-schemas.ts";

const trnsysDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(trnsysDir, "assets", "trnsys-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildTrnsysCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "trnsys",
  packageName: "@modelscript/trnsys-std-lib",
  description: `Cleanroom TRNSYS transient thermal/solar standard library (${schemas.length} Types, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(trnsysDir, "src", "catalog", "trnsys-std-lib-data.ts"),
  constPrefix: "TRNSYS_STD_LIB",
  wasmGetterName: "getTrnsysStdLibWasmBytes",
});
