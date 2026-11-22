// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build-cleanroom-stdlib.js";
import { buildMagicDrawCleanroomSchemas } from "../src/catalog/magicdraw-std-schemas.ts";

const magicdrawDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(magicdrawDir, "assets", "magicdraw-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildMagicDrawCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "magicdraw",
  packageName: "@modelscript/magicdraw-std-lib",
  description: `Cleanroom MagicDraw / Cameo Systems Modeler standard library (${schemas.length} schemas, OMG SysML 1.6 / QUDV / SI ValueTypes, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(magicdrawDir, "src", "catalog", "magicdraw-std-lib-data.ts"),
  constPrefix: "MAGICDRAW_STD_LIB",
  wasmGetterName: "getMagicDrawStdLibWasmBytes",
});
