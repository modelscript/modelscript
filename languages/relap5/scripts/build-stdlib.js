// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildRelap5CleanroomSchemas } from "../src/catalog/relap5-std-schemas.ts";

const relap5Dir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(relap5Dir, "assets", "relap5-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildRelap5CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "relap5",
  packageName: "@modelscript/relap5-std-lib",
  description: `Cleanroom US NRC RELAP5 thermal-hydraulics & reactor kinetics standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(relap5Dir, "src", "catalog", "relap5-std-lib-data.ts"),
  constPrefix: "RELAP5_STD_LIB",
  wasmGetterName: "getRelap5StdLibWasmBytes",
});
