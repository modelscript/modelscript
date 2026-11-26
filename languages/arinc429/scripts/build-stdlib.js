// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildArinc429CleanroomSchemas } from "../src/catalog/arinc429-std-schemas.ts";

const arincDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(arincDir, "assets", "arinc429-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildArinc429CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "arinc429",
  packageName: "@modelscript/arinc429-std-lib",
  description: `Cleanroom ARINC 429 commercial avionics equipment label standard library (${schemas.length} schemas: ADC 203/205/206/211, IRS 310/311/314/324/325, Radio Altimeter 164)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(arincDir, "src", "catalog", "arinc429-std-lib-data.ts"),
  constPrefix: "ARINC429_STD_LIB",
  wasmGetterName: "getArinc429StdLibWasmBytes",
});
