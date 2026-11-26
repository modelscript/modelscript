// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildPowerFactoryCleanroomSchemas } from "../src/catalog/powerfactory-std-schemas.ts";

const pfDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(pfDir, "assets", "powerfactory-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG icons) from declarative schemas
const schemas = buildPowerFactoryCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "powerfactory",
  packageName: "@modelscript/powerfactory-std-lib",
  description: `Cleanroom DIgSILENT PowerFactory Global Library & DSL standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(pfDir, "src", "catalog", "powerfactory-std-lib-data.ts"),
  constPrefix: "POWERFACTORY_STD_LIB",
  wasmGetterName: "getPowerFactoryStdLibWasmBytes",
});
