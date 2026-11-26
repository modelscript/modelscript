// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildIeeeCdfCleanroomSchemas } from "../src/catalog/ieee-cdf-std-schemas.ts";

const ieeeCdfDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(ieeeCdfDir, "assets", "ieee-cdf-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildIeeeCdfCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "ieee-cdf",
  packageName: "@modelscript/ieee-cdf-std-lib",
  description: `Cleanroom IEEE Common Data Format (1973) & BPA IPF power-flow standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(ieeeCdfDir, "src", "catalog", "ieee-cdf-std-lib-data.ts"),
  constPrefix: "IEEE_CDF_STD_LIB",
  wasmGetterName: "getIeeeCdfStdLibWasmBytes",
});
