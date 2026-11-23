// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildNmea0183CleanroomSchemas } from "../src/catalog/nmea0183-std-schemas.ts";

const pkgDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(pkgDir, "assets", "nmea0183-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildNmea0183CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "nmea0183",
  packageName: "@modelscript/nmea0183-std-lib",
  description: `Cleanroom NMEA 0183 marine & GNSS telemetry standard library (${schemas.length} sentence schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(pkgDir, "src", "catalog", "nmea0183-std-lib-data.ts"),
  constPrefix: "NMEA0183_STD_LIB",
  wasmGetterName: "getNmea0183StdLibWasmBytes",
});
