// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildNasaCdfCleanroomSchemas } from "../src/catalog/nasa-cdf-std-schemas.ts";

const nasaCdfDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(nasaCdfDir, "assets", "nasa-cdf-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildNasaCdfCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "nasa-cdf",
  packageName: "@modelscript/nasa-cdf-std-lib",
  description: `Cleanroom NASA CDF / ISTP-SPDF space-physics metadata & magnetometer/plasma telemetry standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(nasaCdfDir, "src", "catalog", "nasa-cdf-std-lib-data.ts"),
  constPrefix: "NASA_CDF_STD_LIB",
  wasmGetterName: "getNasaCdfStdLibWasmBytes",
});
