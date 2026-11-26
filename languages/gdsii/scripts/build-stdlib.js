// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildGdsiiCleanroomSchemas } from "../src/catalog/gdsii-std-schemas.ts";

const gdsiiDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(gdsiiDir, "assets", "gdsii-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative cleanroom CMOS schemas
const schemas = buildGdsiiCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "gdsii",
  packageName: "@modelscript/gdsii-std-lib",
  description: `Cleanroom GDSII CMOS foundry layer-map presets & standard cells (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(gdsiiDir, "src", "catalog", "gdsii-std-lib-data.ts"),
  constPrefix: "GDSII_STD_LIB",
  wasmGetterName: "getGdsiiStdLibWasmBytes",
});
