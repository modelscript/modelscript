// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildRtdsCleanroomSchemas } from "../src/catalog/rtds-std-schemas.ts";

const rtdsDir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(rtdsDir, "assets", "rtds-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildRtdsCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "rtds",
  packageName: "@modelscript/rtds-std-lib",
  description: `Cleanroom RTDS / RSCAD Master Component Library (${schemas.length} EMT schemas, cleanroom SVG icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(rtdsDir, "src", "catalog", "rtds-std-lib-data.ts"),
  constPrefix: "RTDS_STD_LIB",
  wasmGetterName: "getRtdsStdLibWasmBytes",
});
