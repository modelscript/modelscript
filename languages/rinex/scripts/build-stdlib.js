// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildRinexCleanroomSchemas } from "../src/catalog/rinex-std-schemas.ts";

const rinexDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(rinexDir, "assets", "rinex-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildRinexCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "rinex",
  packageName: "@modelscript/rinex-std-lib",
  description: `Cleanroom RINEX v2 GNSS observation types & WGS-84 / ICD-GPS-200 constants standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(rinexDir, "src", "catalog", "rinex-std-lib-data.ts"),
  constPrefix: "RINEX_STD_LIB",
  wasmGetterName: "getRinexStdLibWasmBytes",
});
