// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildDynamoCleanroomSchemas } from "../src/catalog/dynamo-std-schemas.ts";

const dynamoDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(dynamoDir, "assets", "dynamo-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildDynamoCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "dynamo",
  packageName: "@modelscript/dynamo-std-lib",
  description: `Cleanroom MIT DYNAMO System Dynamics standard library (${schemas.length} functions, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(dynamoDir, "src", "catalog", "dynamo-std-lib-data.ts"),
  constPrefix: "DYNAMO_STD_LIB",
  wasmGetterName: "getDynamoStdLibWasmBytes",
});
