// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildGerberCleanroomSchemas } from "../src/catalog/gerber-std-schemas.ts";

const gerberDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(gerberDir, "assets", "gerber-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildGerberCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "gerber",
  packageName: "@modelscript/gerber-std-lib",
  description: `Cleanroom Gerber RS-274X aperture primitives & IPC-2221 DFM standard library (${schemas.length} schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(gerberDir, "src", "catalog", "gerber-std-lib-data.ts"),
  constPrefix: "GERBER_STD_LIB",
  wasmGetterName: "getGerberStdLibWasmBytes",
});
