// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildDoe2CleanroomSchemas } from "../src/catalog/doe2-std-schemas.ts";

const doe2Dir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(doe2Dir, "assets", "doe2-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative ASHRAE/DOE-2 schemas
const schemas = buildDoe2CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "doe2",
  packageName: "@modelscript/doe2-std-lib",
  description: `Cleanroom ASHRAE / LBNL DOE-2 building materials, glazing, and HVAC systems standard library (${schemas.length} schemas, SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(doe2Dir, "src", "catalog", "doe2-std-lib-data.ts"),
  constPrefix: "DOE2_STD_LIB",
  wasmGetterName: "getDoe2StdLibWasmBytes",
});
