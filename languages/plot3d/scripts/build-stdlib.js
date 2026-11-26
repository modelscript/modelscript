// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildPlot3dCleanroomSchemas } from "../src/catalog/plot3d-std-schemas.ts";

const plot3dDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(plot3dDir, "assets", "plot3d-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative schemas
const schemas = buildPlot3dCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "plot3d",
  packageName: "@modelscript/plot3d-std-lib",
  description: `Cleanroom NASA Ames PLOT3D structured CFD standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(plot3dDir, "src", "catalog", "plot3d-std-lib-data.ts"),
  constPrefix: "PLOT3D_STD_LIB",
  wasmGetterName: "getPlot3dStdLibWasmBytes",
});
