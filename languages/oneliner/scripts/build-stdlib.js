// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildOneLinerCleanroomSchemas } from "../src/catalog/oneliner-std-schemas.ts";

const onelinerDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(onelinerDir, "assets", "oneliner-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG icons) from declarative schemas
const schemas = buildOneLinerCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "oneliner",
  packageName: "@modelscript/oneliner-std-lib",
  description: `Cleanroom ASPEN OneLiner Relay & Sequence Equipment Library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(onelinerDir, "src", "catalog", "oneliner-std-lib-data.ts"),
  constPrefix: "ONELINER_STD_LIB",
  wasmGetterName: "getOneLinerStdLibWasmBytes",
});
