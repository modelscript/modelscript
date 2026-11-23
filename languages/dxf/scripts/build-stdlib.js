// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildDxfCleanroomSchemas } from "../src/catalog/dxf-std-schemas.ts";

const dxfDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(dxfDir, "assets", "dxf-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildDxfCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "dxf",
  packageName: "@modelscript/dxf-std-lib",
  description: `Cleanroom AutoCAD DXF standard entity library (${schemas.length} schemas, ACI/layer presets, cleanroom SVG icons, AssemblyScript WASM geometry kernel)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(dxfDir, "src", "catalog", "dxf-std-lib-data.ts"),
  constPrefix: "DXF_STD_LIB",
  wasmGetterName: "getDxfStdLibWasmBytes",
});
